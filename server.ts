import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { DEFAULT_CASES } from "./src/defaultCases";
import { getQueries, getCases, addCase, deleteCase, addCasesBulk, initDatabase } from "./src/neonDb";

dotenv.config();

// Auto-trigger Neon Database initialization if configured
initDatabase().catch(err => console.error("Database self-initialization error:", err));

const checkDevAuth = (code: any) => {
  return code === "fwequiieg1498fahui4890" || code === "56fa864df22be1a4ce7d5d2b77c5eebf99589d980f749ecbe8f2445efdf63da2";
};

const app = express();
const PORT = 3000;
const DB_PATH = path.join(process.cwd(), "data", "db.json");

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Lazy initializer for Gemini client to prevent crashing on missing API key at startup
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다. AI 가동을 위해 설정 > Secrets 메뉴에 API 키를 등록해주세요.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Resilient Content Generation with Model Fallbacks and strict timeouts
async function resilientGenerateContent(ai: any, contents: any, config: any) {
  const modelsToTry = [
    "gemini-3.5-flash",      // Priority 1: Primary standard model for basic text and JSON tasks
    "gemini-3.1-flash-lite", // Priority 2: Very high speed / low latency model
    "gemini-flash-latest"    // Priority 3: Stable fallback model
  ];
  
  let lastError: any = null;
  
  for (const model of modelsToTry) {
    try {
      // Set a generous, robust timeout: 15 seconds is fast enough to fallback, but long enough to avoid spurious timeouts.
      const timeoutMs = 15000;
      console.info(`[RESILIENT-GEMINI] Requesting content... [Model: ${model}] [Timeout: ${timeoutMs}ms]`);
      
      const responsePromise = ai.models.generateContent({
        model,
        contents,
        config,
      });
      
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`System Timeout after ${timeoutMs}ms for ${model}.`)), timeoutMs)
      );
      
      const response = await Promise.race([responsePromise, timeoutPromise]);
      console.info(`[RESILIENT-GEMINI] Success! Model [${model}] completed the request.`);
      return response;
    } catch (err: any) {
      lastError = err;
      console.warn(`[RESILIENT-GEMINI] Error or timeout with model [${model}]:`, err.message || err);
    }
  }
  
  throw lastError || new Error("All fallback models failed.");
}

// Simple keyword matching search tool (RAG equivalent)
async function findMatchingCases(inputText: string, limit: number = 3) {
  const cases = await getCases();
  if (!cases || cases.length === 0) return [];

  // Standard Korean token split & weight
  const cleanAndTokenize = (text: string) => {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\n]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 1);
  };

  const inputTokens = cleanAndTokenize(inputText);
  if (inputTokens.length === 0) {
    return cases.slice(0, limit);
  }

  const scoredCases = cases.map((c: any) => {
    let score = 0;
    const responseLower = (c.studentResponse || "").toLowerCase();
    const idealLower = (c.idealResponse || "").toLowerCase();
    const categoryLower = (c.category || "").toLowerCase();

    inputTokens.forEach(token => {
      // Weight matching phrases
      if (responseLower.includes(token)) score += 5;
      if (idealLower.includes(token)) score += 2;
      if (categoryLower.includes(token)) score += 3;
    });

    return { ...c, score };
  });

  // Sort from most similar to least similar, only keeping scores > 0 if possible
  scoredCases.sort((a, b) => b.score - a.score);
  return scoredCases.slice(0, limit);
}

// --- API ENDPOINTS ---

// 0. Get database status
app.get("/api/db/status", (req, res) => {
  res.json({
    neon: !!process.env.DATABASE_URL
  });
});

// 1. Get the list of 6 standard inquiries
app.get("/api/db/queries", async (req, res) => {
  const queries = await getQueries();
  res.json({ queries });
});

// 2. Get all custom cases
app.get("/api/db/cases", async (req, res) => {
  const cases = await getCases();
  res.json({ cases });
});

// 3. Add a single counseling record
app.post("/api/db/case", async (req, res) => {
  const { queryId, category, studentResponse, idealResponse, riskLevel, devCode } = req.body;
  const headerCode = req.headers["x-developer-code"];
  if (!checkDevAuth(devCode) && !checkDevAuth(headerCode)) {
    return res.status(403).json({ error: "개발자 권한 인증이 필요합니다. 올바른 패스코드를 기입해 주십시오." });
  }

  if (!studentResponse || !idealResponse || !riskLevel) {
    return res.status(400).json({ error: "필수 입력 항목(청소년 답변, 권장 위로 조언, 위험도)이 빈칸입니다." });
  }

  const newCase = {
    id: `custom-case-${Date.now()}`,
    queryId: queryId ? Number(queryId) : null,
    category: category || "직접 정의",
    studentResponse,
    idealResponse,
    riskLevel,
    strategy: req.body.strategy || "맞춤 감정 지지 및 충동 관리",
  };

  const success = await addCase(newCase);
  if (success) {
    const currentCases = await getCases();
    res.json({ success: true, case: newCase, totalCount: currentCases.length });
  } else {
    res.status(500).json({ error: "데이터베이스 자료 추가 중 오류가 발생했습니다." });
  }
});

// 4. Delete a counseling record
app.post("/api/db/case/delete", async (req, res) => {
  const { id, devCode } = req.body;
  const headerCode = req.headers["x-developer-code"];
  if (!checkDevAuth(devCode) && !checkDevAuth(headerCode)) {
    return res.status(403).json({ error: "개발자 권한 인증이 필요합니다. 올바른 패스코드를 기입해 주십시오." });
  }

  if (!id) return res.status(400).json({ error: "지정된 식별자 ID가 누락되었습니다." });

  const success = await deleteCase(id);
  if (success) {
    const currentCases = await getCases();
    res.json({ success: true, totalCount: currentCases.length });
  } else {
    res.status(404).json({ error: "해당 사례를 데이터베이스에서 찾지 못했거나 제거할 수 없습니다." });
  }
});

// 5. Bulk upload parsed texts (JSON, CSV or unstructured lines of records)
app.post("/api/db/cases/bulk", async (req, res) => {
  const { textData, format, devCode } = req.body;
  const headerCode = req.headers["x-developer-code"];
  if (!checkDevAuth(devCode) && !checkDevAuth(headerCode)) {
    return res.status(403).json({ error: "개발자 권한 인증이 필요합니다. 올바른 패스코드를 기입해 주십시오." });
  }

  if (!textData) {
    return res.status(400).json({ error: "가져올 텍스트 데이터가 전달되지 않았습니다." });
  }

  let parsedCases: any[] = [];

  try {
    if (format === "json") {
      // Attempt JSON parser
      const parsed = JSON.parse(textData);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach((item: any, idx: number) => {
        parsedCases.push({
          id: `bulk-json-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
          queryId: item.queryId ? Number(item.queryId) : (item.id ? Number(item.id) : null),
          category: item.category || "일반 심리 상담",
          studentResponse: item.studentResponse || item.response || item.text || item.questionAnswer || "답변 없음",
          idealResponse: item.idealResponse || item.counselorResponse || item.advice || "조언 없음",
          riskLevel: item.riskLevel || item.risk || "Medium Risk",
          strategy: item.strategy || "일반적 공감 및 지지 정책",
        });
      });
    } else if (format === "csv") {
      // Simple CSV Parse (handles basic split, fallback on simpler splitter if complex commas)
      const lines = textData.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      let headers: string[] = [];
      
      lines.forEach((line: string, index: number) => {
        // basic quote-safe split
        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, "").trim());
        if (index === 0) {
          headers = parts.map(h => h.toLowerCase());
        } else {
          // Fallback column indexing
          // Expected: Category, Adolescent Answer, Counselor Advice, Risk Level
          const category = parts[0] || "대용량 업로드";
          const studentResponse = parts[1] || "답변 공백";
          const idealResponse = parts[2] || "전문 조언 공백";
          const riskLevel = parts[3] || "Medium Risk";
          const strategy = parts[4] || "기본 상담 지지";
          
          parsedCases.push({
            id: `bulk-csv-${Date.now()}-${index}`,
            queryId: null,
            category,
            studentResponse,
            idealResponse,
            riskLevel,
            strategy,
          });
        }
      });
    } else {
      // Natural unstructured TEXT Block format (Double-newline separated card items)
      // e.g.:
      // 답변: 죽어버리고 싶어요
      // 상담: 어구, 힘 내
      // 위험도: High Risk
      const blocks = textData.split(/\n\s*\n/).filter((b: string) => b.trim().length > 0);
      
      blocks.forEach((block: string, idx: number) => {
        const lines = block.split("\n").map(l => l.trim());
        let category = "자연어 파싱 대답";
        let studentResponse = "";
        let idealResponse = "";
        let riskLevel = "Medium Risk";
        let strategy = "자동 주입 개입수정";

        lines.forEach(line => {
          if (line.startsWith("답변:") || line.startsWith("청소년:") || line.startsWith("학생:") || line.startsWith("대답:")) {
            studentResponse = line.substring(4).trim();
          } else if (line.startsWith("상담:") || line.startsWith("가이드:") || line.startsWith("조언:") || line.startsWith("선생님:")) {
            idealResponse = line.substring(4).trim();
          } else if (line.startsWith("위험도:") || line.startsWith("등급:") || line.startsWith("레벨:")) {
            riskLevel = line.substring(4).trim();
          } else if (line.startsWith("카테고리:") || line.startsWith("분류:")) {
            category = line.substring(5).trim();
          } else if (line.startsWith("전략:") || line.startsWith("방법:")) {
            strategy = line.substring(3).trim();
          }
        });

        // Fallback for unlabeled lines - split first half and second half
        if (!studentResponse && lines[0]) {
          studentResponse = lines[0];
          idealResponse = lines.slice(1).join(" ");
        }

        if (studentResponse && idealResponse) {
          parsedCases.push({
            id: `bulk-txt-${Date.now()}-${idx}`,
            queryId: null,
            category,
            studentResponse,
            idealResponse,
            riskLevel,
            strategy,
          });
        }
      });
    }

    if (parsedCases.length === 0) {
      return res.status(400).json({ error: "형식 분석에 실패했거나 임포트 가능한 데이터 항목이 0건입니다." });
    }

    const count = await addCasesBulk(parsedCases);
    const currentCases = await getCases();
    res.json({ success: true, count, totalCount: currentCases.length });

  } catch (err: any) {
    console.error("Bulk upload parse error:", err);
    res.status(400).json({ error: `데이터 파싱 중 에러 발생: ${err.message}` });
  }
});

// 6. Real-time Diagnostic Evaluation or Chat Counselor Response
app.post("/api/counsel/analyze", async (req, res) => {
  const { currentInput, activeQueryId, chatHistory } = req.body;
  if (!currentInput) {
    return res.status(400).json({ error: "상담 또는 진단을 위한 대화 내용이 존재하지 않습니다." });
  }

  // 1. Critical Safety Rules - Fast Keyword Interceptor for immediate compliance & cost prevention
  const cleanInput = (currentInput || "").toLowerCase().replace(/\s+/g, "");
  const hasCrisisKeyword = [
    "자살", "자해", "죽고싶다", "죽어야지", "죽고파", "죽을래", "학대", "가정폭력", "아동학대", "심각한폭력", "사라지고싶다", "포기하고싶다"
  ].some(kw => cleanInput.includes(kw));

  if (hasCrisisKeyword) {
    return res.json({
      success: true,
      analysis: {
        riskLevel: "Critical",
        insight: "울컥 피어난 마음 무거운 그늘 (위기 감지)",
        warmResponse: "그렇게 이야기할 만큼 지금 네 마음의 날씨가 많이 차갑고 무겁구나. 혼자서 이 서늘한 바람을 견디느라 얼마나 외롭고 지쳤을지 감히 다 헤아릴 수 없지만, 이 힘든 시간을 너 혼자 아파하며 보내지 않았으면 좋겠어. \n\n여기 네 이야기를 밤낮없이 진심으로 들어주고, 따뜻하게 손 잡아줄 수 있는 전문 선생님들이 계셔. 언제든 편한 방법으로 연락해 봐. 언제나 네 편이 되어주실 거야. 😊\n- 청소년 모바일 상담 '다들어줄개': 문자 1388 / 카카오톡 채널 검색\n- 청소년전화: 국번없이 1388 (24시간 운영)",
        triggerAlert: true,
        heartTemperature: 10,
        suggestions: [
          "눈을 지긋이 감고 찬찬히 다섯 번의 깊은 심호흡 하기",
          "의자에 편안하게 몸을 기대어 따듯한 물 한 머금 마시기",
          "가까운 청소년 온라인/모바일 1388 전문 선생님의 안전한 상담 연동하기"
        ]
      },
      matchedReferenceCases: []
    });
  }

  // 1.5. Casual Greeting Interceptor (일상 인사 가로채기 시스템 연동)
  const isCasualGreeting = (text: string): boolean => {
    const clean = text.trim().replace(/[?!\.\s]/g, "");
    const greetingKeywords = [
      "안녕", "안녕하세요", "반가워", "반갑다", "반갑네", "반가워요", "나도반가워", "하이", "하이요", "hi", "hello", "안뇽", "안농", "방가", "노아야", "노아안녕", "안녕노아"
    ];
    const worryKeywords = [
      "힘들", "슬퍼", "우울", "자책", "자살", "자해", "죽고", "짜증", "공부", "성적", "시험", "엄마", "아빠"
    ];
    const hasWorry = worryKeywords.some(w => clean.includes(w));
    if (hasWorry) return false;
    return greetingKeywords.some(g => clean === g || clean.startsWith(g)) && clean.length <= 12;
  };

  if (isCasualGreeting(currentInput)) {
    const greetingResponses = [
      "어 안녕! 진짜 반가워. 오늘 하루 어떻게 보냈어? 형한테 무슨 일이든 편안하게 들려줘.",
      "오 왔구나! 반가워. 오늘 밤에 무슨 재미있는 수다 떨까? 마음 편하게 얘기해 줘.",
      "안녕안녕! 오늘 하루는 별일 없었어? 무슨 일 있었는지 형한테 다 얘기해 봐. 다 들어줄게.",
      "안녕! 어서 와. 오늘 네 마음의 날씨는 어때? 맑음이야, 아니면 조금 흐림이야?"
    ];
    // Simple stateful calculation to preserve non-repetitive response across messages
    const idx = Math.abs(currentInput.length + (chatHistory?.length || 0)) % greetingResponses.length;
    const selectedResponse = greetingResponses[idx];

    return res.json({
      success: true,
      analysis: {
        riskLevel: "Safe",
        insight: "일상 친근 인사 소통",
        warmResponse: `${selectedResponse}\n[자기이해 및 자아상]`,
        triggerAlert: false,
        heartTemperature: 36.5,
        suggestions: [
          "편안히 기지개 한 번 켜보기",
          "시원한 물 한 모금 마시기",
          "가만히 눈 감고 5초간 가벼운 쉼 누리기"
        ]
      },
      matchedReferenceCases: []
    });
  }

  try {
    const ai = getGeminiClient();

    // RAG Step: Search database for similar adolescent cases to train/ground our model
    const matchedCases = await findMatchingCases(currentInput, 3);
    const databaseContext = matchedCases.map((c: any, index: number) => {
      return `[참조사례 ${index + 1}]
- 청소년 속마음 고백: "${c.studentResponse}"
- 분석된 위험 점수: "${c.riskLevel}"
- 전문 상담사의 안전 전략: "${c.strategy}"
- 권장 공감적 위로 가이드: "${c.idealResponse}"`;
    }).join("\n\n");

    const queries = await getQueries();
    const queryDetail = activeQueryId 
      ? (queries || []).find((q: any) => q.id === Number(activeQueryId)) 
      : null;

    // Build natural text dialogue history with cleaned inputs (no category brackets to avoid recursive category leaks)
    let historyContextText = "";
    if (chatHistory && Array.isArray(chatHistory)) {
      historyContextText = chatHistory.map((h: any) => {
        const displayName = h.role === "user" ? "청소년" : "노아";
        const cleanText = h.text ? h.text.replace(/\[\s*(자기이해 및 자아상|인간관계 스트레스|힘들고 우울한 마음|우울하고 지친 마음|수면 및 휴식 욕구|진로 및 학업 고민|공부와 미래 고민|가족 갈등)\s*\]/g, "").trim() : "";
        return `[${displayName}]: ${cleanText}`;
      }).join("\n");
    }

    // Determine if we are in diagnostic mode or interactive chatbot mode
    const isDiagnosticMode = !!(activeQueryId && queryDetail);

    // Differentiate System Instructions based on user intent (Diagnostic vs Chatbot)
    const systemPrompt = isDiagnosticMode 
      ? `당신은 청소년 감정 진단 및 안심 케어를 전담하는 마음 상담사 '노아(Noa)'입니다.
청소년이 작성한 분야 문진 답변을 공정하게 분석하여 전문가 소견(insight), 마음 온도, 그리고 100% 맞춤형 위로 조언(warmResponse)을 제공하십시오.

★ [진단 모드 대화 규칙] ★
- 제시하는 진단 위로조언(warmResponse)은 카드 형식의 한눈에 쏙 들어오는 가독성을 위해 **약 2~3문장 정도**로 핵심만 간결하고 강력하게 작성해 주십시오.
- 딱딱하고 차가운 전문 임상 심리 용어는 쓰지 마시고, 찐형/누나가 건네는 따스하고 직관적인 입말로 위로해 주십시오.
- 문학 소년식의 과도한 오글거리는 은유 표현은 금지합니다.

★ [🎯 시스템 연동을 위한 숨김 규칙 (맨 마지막 줄 고정)] ★
대답을 다 끝내고 **맨 마지막 줄에만** 아래 6대 기둥 중 사용자의 고민과 가장 가까운 카테고리 딱 하나를 대괄호 형태로 소리 없이 출력하십시오. (줄바꿈 후 단수 줄 형태)
기둥 목록: [자기이해 및 자아상], [인간관계 스트레스], [힘들고 우울한 마음], [수면 및 휴식 욕구], [진로 및 학업 고민], [가족 갈등]`
      : `당신은 청소년들이 마음의 문을 열고 고민을 편히 털어놓을 수 있는 친근하고 다정한 동네 형/누나 같은 AI 상담사 '노아(Noa)'입니다.

★ [최우선 미션: 자연스러운 대화 연결 & 능동적 경청과 추론] ★
- 현재 건네진 사용자의 한마디를 깊이 이해했음을 리액션으로 충분히 표현하십시오. 단절되거나 겉도는 로봇 같은 말투는 절대 지양하십시오.
- 기계적인 앵무새 답변을 마십시오. 대화 상대가 전하는 기분, 뉘앙스, 처한 구체적 상황의 이면을 감성적이고 논리적으로 추론하여 "아, 너 많이 주눅 들고 부모님 눈치 때문에 괴로웠겠구나" 식의 깊은 추론과 연결 관계를 짚어 주십시요.
- 이전 나눈 대화 맥락이 제공되면, 과거 나눴던 주제를 자연스럽게 상기시키거나 대화의 흐름을 이어가며 다정함을 쌓아가십시오.
- 일방적으로 엉뚱한 열린 질문을 갑자기 던져서 맥락을 뚝 끊고 취조하는 느낌을 주지 마십시오. "너도 그런 적 있어?" 유의 질문을 기계적으로 반복하지 말고, 청소년의 말에 대해 한층 진심 어린 공감을 먼저 표한 다음, 편안하게 답할 수 있도록 가벼운 흐름을 이어가십시오.

★ [대화 톤앤매너 규칙] ★
- 철저하게 친구와 카톡 하듯 일상적이고 다정한 말투로 자연스럽게 대화하십시오. (친근한 "~했구나", "~했어?", "그럴 만하다", "그렇지 않아" 등 가볍고 부드러운 카톡 어조 사용)
- 인지왜곡, 감정수용 등 딱딱한 전문 심리치료 용어는 전혀 쓰지 마십시오.
- 오글거리는 과도한 시적 표현 (예: "눈물 비", "외로운 수렁 속에 영롱한 별") 은 쓰지 마십시오. 담백하고도 따사롭게 톡하듯이 말하십시오.
- 대화의 길이는 고정된 2문장 압박에서 벗어나 자연스럽게 2~4문장 내외로 대화의 깊이에 맞춰 유연하게 조절하십시오. 

★ [상담사례 데이터 수용 지침] ★
- 참고할 수 있는 기존 DB 사례를 유저에게 그대로 화면에 긁어서 출력(Ctrl+C, Ctrl+V 하듯)하지 마십시오. 오직 청소년 감정과 마음의 방향성을 이해하기 위한 '생각의 재료(내부 지식)'로만 비공개 참고하십시오.

★ [🎯 시스템 연동을 위한 숨김 규칙 (맨 마지막 줄 고정)] ★
대답을 다 끝내고 **맨 마지막 줄에만** 아래 6대 기둥 중 사용자의 고민과 가장 가까운 카테고리 딱 하나를 대괄호 형태로 소리 없이 출력하십시오. (줄바꿈 후 단수 줄 형태)
기둥 목록: [자기이해 및 자아상], [인간관계 스트레스], [힘들고 우울한 마음], [수면 및 휴식 욕구], [진로 및 학업 고민], [가족 갈등]`;

    const instructionsText = isDiagnosticMode
      ? `현재 청소년이 응답 중인 부문: [${queryDetail?.category}]
과제 질문: "${queryDetail?.question}"
청소년의 구체적인 서술 대답: "${currentInput}"
[참고할 수 있는 기존 마음치료 DB 사례]:
${databaseContext}`
      : `현재 청소년과 대화 중인 마음 치유방에서의 메시지 내역입니다.

[상황 대화 흐름]
${historyContextText ? `지금까지 청소년과 나눈 대화 맥락:\n${historyContextText}\n` : ""}
청소년이 방금 건넨 최신 말: "${currentInput}"

[참고할 수 있는 기존 마음치료 DB 사례]:
${databaseContext}`;

    // Call Resilient Gemini helper with retries and fallbacks
    const response = await resilientGenerateContent(ai, instructionsText, {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          riskLevel: {
            type: Type.STRING,
            description: "전체적인 위험 분석 수준: 'Safe', 'Low Risk', 'Medium Risk', 'High Risk', 'Critical'"
          },
          insight: {
            type: Type.STRING,
            description: "청소년의 입력 정보에서 읽어낸 핵심 심리 지표 및 마음 상태 요약"
          },
          warmResponse: {
            type: Type.STRING,
            description: "청소년의 손을 잡아주는 대단히 따뜻하고 감정 가득한 전문 심리상담사의 긴밀 위로 조언"
          },
          triggerAlert: {
            type: Type.BOOLEAN,
            description: "직접적인 자해 정황이나 자살 위기 상태가 인정되는 경우 true, 그 외는 false"
          },
          heartTemperature: {
            type: Type.INTEGER,
            description: "마음의 온도 값 (0부터 100 사이 숫자)"
          },
          suggestions: {
            type: Type.ARRAY,
            description: "아이에게 실질적인 따뜻함을 건넬 수 있는 귀여운 홈케어 위로 행동가이드 3선",
            items: { type: Type.STRING }
          }
        },
        required: ["riskLevel", "insight", "warmResponse", "triggerAlert", "heartTemperature", "suggestions"]
      },
      temperature: 0.8,
    });

    const parsedResponse = JSON.parse(response.text || "{}");

    // Override warmResponse if self-harm or high threat triggered either by keyword or AI judgment
    if (parsedResponse.triggerAlert || parsedResponse.riskLevel === "High Risk" || parsedResponse.riskLevel === "Critical") {
      parsedResponse.triggerAlert = true;
      parsedResponse.warmResponse = `그렇게 이야기할 만큼 지금 네 마음의 날씨가 많이 차갑고 무겁구나. 혼자서 이 서늘한 바람을 견디느라 얼마나 외롭고 지쳤을지 감히 다 헤아릴 수 없지만, 이 힘든 시간을 너 혼자 아파하며 보내지 않았으면 좋겠어. 

여기 네 이야기를 밤낮없이 진심으로 들어주고, 따뜻하게 손 잡아줄 수 있는 전문 선생님들이 계셔. 언제든 편한 방법으로 연락해 봐. 언제나 네 편이 되어주실 거야. 😊
- 청소년 모바일 상담 '다들어줄개': 문자 1388 / 카카오톡 채널 검색
- 청소년전화: 국번없이 1388 (24시간 운영)`;
    }

    res.json({
      success: true,
      analysis: parsedResponse,
      matchedReferenceCases: matchedCases.map(c => ({
        category: c.category,
        studentResponse: c.studentResponse,
        idealResponse: c.idealResponse,
        riskLevel: c.riskLevel
      }))
    });

  } catch (err: any) {
    console.error("Gemini analytical handler crashed:", err);
    res.json({
      success: true,
      analysis: {
        riskLevel: "Safe",
        insight: "다소 붐비는 치유 센터 통신망 접선",
        warmResponse: "현재 상담을 원하는 친구들이 많아서 대화방이 조금 붐비고 있어! 미안해 ㅠㅠ 잠시 후에 나에게 다시 말을 걸어주면 더 귀 기울여 들어줄게!",
        triggerAlert: false,
        heartTemperature: 36.5,
        suggestions: ["잠시 후 다시 말 걸어보기", "따뜻한 물 한 잔 머금기", "기지개 가볍게 켜기"]
      },
      matchedReferenceCases: []
    });
  }
});

// --- CLIENT STATIC AND VITE MIDDLEWARE INTERPOLATOR ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server started successfully. Running on health port: http://0.0.0.0:${PORT}`);
  });
}

startServer();
