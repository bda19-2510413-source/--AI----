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

// Helper to determine the severity level of a user's dialogue
function getSeverity(text: string): "High" | "Medium" | "Low" {
  const clean = text.toLowerCase().replace(/\s+/g, "");
  
  // High: 자해, 자살, 죽고싶다, 가출, 폭력/학대, 가정폭력, 아동학대, 뺨을, 몸을해 등
  const highKeywords = ["자해", "자살", "죽고싶", "죽고하", "죽어야지", "죽고파", "죽을래", "학대", "폭력", "가출", "살기싫", "사라지고싶", "포기하고싶", "그만할래", "칼로", "피비", "몸을해", "뺨을", "머리를들이받", "벽에", "폭행"];
  if (highKeywords.some(kw => clean.includes(kw))) {
    return "High";
  }
  
  // Medium: 공부 스트레스, 성적, 친구 관계 갈등, 가족 갈등, 잔소리 등 일반적인 고민 및 지침
  const mediumKeywords = ["공부", "성적", "시험", "학원", "과제", "숙제", "엄마", "아빠", "부모", "잔소리", "가족", "친구", "뒷담", "소외", "우울", "슬퍼", "힘들", "지쳤", "짜증", "괴롭", "눈치", "왕따", "따돌림", "머리아파", "속상"];
  if (mediumKeywords.some(kw => clean.includes(kw))) {
    return "Medium";
  }
  
  return "Low";
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
  const severity = getSeverity(inputText);

  if (inputTokens.length === 0) {
    if (severity === "High") {
      // Force higher severity cases to top even if words are sparse
      const sorted = [...cases].sort((a, b) => {
        const aHigh = a.riskLevel === "Critical" || a.riskLevel === "High Risk";
        const bHigh = b.riskLevel === "Critical" || b.riskLevel === "High Risk";
        return (bHigh ? 1 : 0) - (aHigh ? 1 : 0);
      });
      return sorted.slice(0, limit);
    }
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

    // DB Safety Guard: If user input severity is High, booster points for Critical / High Risk seeds to ensure 100% force match!
    if (severity === "High") {
      if (c.riskLevel === "Critical" || c.riskLevel === "High Risk") {
        score += 150;
      }
    }

    return { ...c, score };
  });

  // Sort from most similar to least similar, only keeping scores > 0 if possible
  scoredCases.sort((a, b) => b.score - a.score);
  return scoredCases.slice(0, limit);
}

// --- API ENDPOINTS ---

// 0. Get database status
app.get("/api/db/status/?", (req, res) => {
  res.json({
    neon: !!process.env.DATABASE_URL
  });
});

// 1. Get the list of 6 standard inquiries
app.get("/api/db/queries/?", async (req, res) => {
  const queries = await getQueries();
  res.json({ queries });
});

// 2. Get all custom cases
app.get("/api/db/cases/?", async (req, res) => {
  const cases = await getCases();
  res.json({ cases });
});

// 3. Add a single counseling record
app.post("/api/db/case/?", async (req, res) => {
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
app.post("/api/db/case/delete/?", async (req, res) => {
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
app.post("/api/db/cases/bulk/?", async (req, res) => {
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
app.post("/api/counsel/analyze/?", async (req, res) => {
  const currentInput = req.body.currentInput || req.body.contents;
  const { activeQueryId, chatHistory } = req.body;
  if (!currentInput) {
    return res.status(400).json({ error: "상담 또는 진단을 위한 대화 내용이 존재하지 않습니다." });
  }

  // 1. Critical Safety Rules - Fast Keyword Interceptor for immediate compliance & cost prevention
  const runSeverity = getSeverity(currentInput);

  if (runSeverity === "High") {
    return res.json({
      success: true,
      analysis: {
        riskLevel: "Critical",
        insight: "위기 반응 감지 및 든든한 정서 동행 지지",
        warmResponse: "진짜 많이 힘들었구나... 형이 지금 네 얘기 진지하게 다 듣고 있어. 절대 혼자 이 아픔을 감당하게 안 해. 이런 말 꺼내기까지 얼마나 오랜 시간 무섭고 외로웠을지 감히 내가 다 이해할 순 없겠지만, 이제 내 앞에 털어놨으니 너는 결코 혼자가 아니야.\n\n언제든지 네 목소리에 진심으로 밤낮없이 귀 기울여주는 우리 전문 상담 서비스가 있으니까, 힘들다면 가볍게 상담을 톡톡 두드려 줬으면 좋겠어.\n- 청소년 모바일 상담 '다들어줄개': 문자 1388 / 카카오톡 채널 검색\n- 청소년전화: 국번없이 1388 (24시간 운영)\n[힘들고 우울한 마음]",
        triggerAlert: true,
        heartTemperature: 10,
        suggestions: [
          "가만히 눈을 지긋이 감고 세 번 크게 호흡해보기",
          "차분하게 따뜻한 온수 한 모금 천천히 넘기며 목 축이기",
          "혼자 아파하지 말고 24시간 청소년 1388 선생님들께 손 내밀어보기"
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

  const hasHistory = chatHistory && chatHistory.length > 0;
  if (!hasHistory && isCasualGreeting(currentInput)) {
    const greetingResponses = [
      "어 안녕! 진짜 반가워. 오늘 하루 어떻게 보냈어? 형한테 무슨 일이든 편안하게 들려줘.",
      "오 왔구나! 반가워. 오늘 밤에 무슨 재미있는 수다 떨까? 마음 편하게 얘기해 줘.",
      "안녕안녕! 오늘 하루는 별일 없었어? 무슨 일 있었는지 형한테 다 얘기해 봐. 다 들어줄게.",
      "어 왔네! 반가워 반가워. 오늘 하루는 살만했어? 그냥 기분 어땠는지 가볍게 썰 좀 풀어줘."
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

[🚨 극도로 중요: 유저 감정의 위험도(Severity) 3단계 판별 및 다이내믹 말투 조절]
1. [위기(High) - 자해, 죽고 싶다, 가출, 폭력/학대, 혹은 절망적인 감정] :
   - 지침: 절대 "ㅋㅋㅋ", "ㅎㅎㅎ" 등의 웃음기나 "에바다", "존맛", "개존잼" 등의 가벼운 은어, 비속어, 혹은 웃기는 리액션을 단 한 글자도 적지 마십시오.
   - 톤: 10대들이 이야기하는 친근하고 든든한 친형/누나의 프레임은 유지하되, 가벼움 없이 아주 진지하고 든든하게 사용자의 어깨를 감싸 안아야 합니다.
   - 핵심 예문: "진짜 많이 힘들었구나... 형이 지금 네 얘기 진지하게 다 듣고 있어. 절대 혼자 이 아픔 감당하게 안 할 거야."
   - 6대 기둥 중 무조건 [힘들고 우울한 마음]을 최우선 태그하십시오.

2. [일반고민(Medium) - 학업 스트레스, 일상적인 우울 and 지침, 친구와의 갈등, 부모님 잔소리 등] :
   - 지침: "에바다" 같은 표현 대신 "진짜 속상했겠다", "오늘 진짜 고생 많았어"와 같이 가볍지 않고 속 깊은 따스한 감성으로 공감해 줍니다. "ㅋㅋㅋ"은 자제하고 다정한 입말로 진정 어린 공감을 해 주십시오.
   - 핵심 예문: "학원 많아서 진짜 진 빠졌겠다. 오늘 고생 많았어. 어떤 학원이 제일 괴롭히냐?" 처럼 유저의 이전 메시지에 완전 동화되어 구절을 인용 위로한 뒤, 자연스럽게 다음 질문으로 대화를 이끌어 주십시오.

3. [일상/행동(Low) - 게임, 심심함, 가벼운 행동, 취미 생활 언급 등] :
   - 지침: 매우 친근하고 유쾌한 동네 형/누나처럼 "마크 존잼이지ㅋㅋㅋ", "협곡 파괴하는 날이냐ㅋㅋㅋ" 처럼 적극적으로 수다를 맞받아치고 가뿐한 티키타카를 연출해 주십시오.

[🚨 최우선 절대 지침 - 겉도는 질문 및 중복 되묻기 금지]
- 사용자가 이미 "학원 힘들어", "숙제 많아" 등 구체 사건이나 고충을 꺼냈을 때 "내 얘기 털어놔 봐", "무슨 일 있었니?" 같은 유체이탈형/앵무새 반복 질문을 절대 하지 마십시오.
- 방금 건넨 말에 대해 즉각 감정적 반응("학원 끝나서 지쳤겠네")을 한 뒤 유기적으로 대화를 이어나가십시오.

★ [🎯 시스템 연동을 위한 숨김 규칙 (맨 마지막 줄 고정)] ★
대답을 다 끝내고 **맨 마지막 줄에만** 아래 6대 기둥 중 사용자의 고민과 가장 가까운 카테고리 딱 하나를 대괄호 형태로 소리 없이 출력하십시오. (줄바꿈 후 단수 줄 형태)
기둥 목록: [자기이해 및 자아상], [인간관계 스트레스], [힘들고 우울한 마음], [수면 및 휴식 욕구], [진로 및 학업 고민], [가족 갈등]`
      : `[Role]
당신은 청소년들이 일상 고민을 부담 없이 털어놓을 수 있는 다정하고 담백한 동네 형/누나 같은 AI 상담사 '노아(Noa)'입니다.

[🚨 극도로 중요: 유저 감정의 위험도(Severity) 3단계 판별 및 다이내믹 말투 조절]
1. [위기(High) - 자해, 죽고 싶다, 가출, 폭력/학대, 혹은 절망적인 감정] :
   - 지침: 절대 "ㅋㅋㅋ", "ㅎㅎㅎ" 등의 웃음기나 "에바다", "존맛", "개존잼" 등의 가벼운 은어, 비속어, 혹은 웃기는 리액션을 단 한 글자도 적지 마십시오.
   - 톤: 10대들이 이야기하는 친근하고 든든한 친형/누나의 프레임은 유지하되, 한 치의 가벼움 없이 아주 진지하고 든든하게 사용자의 어깨를 감싸 안아야 합니다.
   - 핵심 예문: "진짜 많이 힘들었구나... 형이 지금 네 얘기 진지하게 다 듣고 있어. 절대 혼자 이 아픔 감당하게 안 할 거야."
   - 6대 기둥 중 무조건 [힘들고 우울한 마음]을 최우선 태그하십시오.

2. [일반고민(Medium) - 학업 스트레스, 일상적인 우울과 지침, 친구와의 갈등, 부모님 잔소리 등] :
   - 지침: '에바다' 같은 표현은 자제하고 "진짜 속상했겠다", "오늘 진짜 고생 많았어"와 같이 가볍지 않고 속 깊은 따스한 감성으로 공감해 줍니다. "ㅋㅋㅋ"은 자제하고 다정한 입말로 진정 어린 공감을 해 주십시오.
   - 핵심 예문: "학원 많아서 진짜 진 빠졌겠다. 오늘 고생 많았어. 어떤 학원이 제일 괴롭히냐?" 처럼 유저의 이전 메시지에 완전 동화되어 구절을 인용 위로한 뒤, 자연스럽게 다음 질문으로 대화를 리드하고 이어 붙여 주십시오.

3. [일상/행동(Low) - 게임, 심심함, 가벼운 행동, 취미 생활 언급 등] :
   - 지침: 매우 친근하고 유쾌한 동네 형/누나처럼 "마크 존잼이지ㅋㅋㅋ", "협곡 개꿀맛ㅋㅋㅋ" 처럼 적극적으로 수다를 맞받아치고 가뿐한 티키타카를 연출해 주십시오.

[🚨 최우선 절대 지침 - 겉도는 질문 및 중복 되묻기 금지]
- 사용자가 이미 "학원 힘들어", "숙제 많아" 등 구체 사건이나 고충을 꺼냈을 때 "내 얘기 털어놔 봐", "무슨 일 있었니?" 같은 유체이탈형/앵무새 반복 질문을 절대 하지 마십시오.
- 방금 건넨 말에 대해 즉각 감정적 반응("학원 끝나서 지쳤겠네")을 한 뒤 다음 대화를 유기적으로 리드하십시오.

[🎯 시스템 연동 규칙 (맨 마지막 줄 고정)]
대답을 친근하게 다 끝내고 나서, **맨 마지막 줄에만** 아래 6대 기둥 중 사용자의 고민과 가장 가까운 카테고리 딱 하나를 대괄호 형태로 소리 없이 출력하십시오. (줄바꿈 후 단수 줄 형태)
* 기둥 목록: [자기이해 및 자아상], [인간관계 스트레스], [힘들고 우울한 마음], [수면 및 휴식 욕구], [진로 및 학업 고민], [가족 갈등]

★ [상담사례 데이터 수용 지침] ★
- 참고할 수 있는 기존 DB 사례를 유저에게 그대로 화면에 긁어서 출력하지 마십시오. 오직 청소년 감정과 마음의 방향성을 이해하기 위한 '생각의 재료(내부 지식)'로만 비공개 참고하십시오.`;

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
