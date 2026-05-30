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

    // Define System Instructions matching user requests perfectly: Persona, Tone, Survey Context and Cost Rules.
    const systemPrompt = `당신은 청소년들이 고민을 편하게 털어놓을 수 있는 찐친 같은 AI 상담사 '노아(Noa)'입니다.
당신의 임무는 사용자가 제공하는 고민 분류(category_name)와 실제 입력 문장(answer_full) 데이터를 기반으로, 청소년들의 마음을 찰떡같이 공감하고 전문적인 6대 마음 기둥 지침를 적용해 대화를 자연스레 이어가는 것입니다.

★ [★ 6대 기둥 명시 규칙 ★] ★
상담 답변(warmResponse) 중간이나 끝에, 청소년의 감정을 대변하는 6대 기둥의 카테고리 명을 반드시 정확한 '단어'([대괄호] 포함)로 콕 집어 언급하고 위로해 주십시오. 
6대 기둥 이름 목록:
- [자기이해 및 자아상] : 자책, 낮은 자존감, "난 왜 이 모양일까", "성격이 구리다" 등의 태도 일 때 명시.
- [인간관계 스트레스] : 소심함, 관계 소외, 친구 문제, 소통의 어려움 일 때 명시.
- [힘들고 우울한 마음] : 슬픔, 가벼운 우울감이나 우울하다는 한탄 일 때 명시.
- [수면 및 휴식 욕구] : 무기력감, 귀찮음, "씻기도 싫다", "차라리 자는 게 낫다"며 회피하려 할 때 명시.
- [진로 및 학업 고민] : 성적, 미래, 시험 공부, 대입, 학교생활 압박 일 때 명시.
- [가족 갈등] : 부모님, 엄마, 아빠와의 불화 및 잔소리에 지쳤을 때 명시.

(예시 문구형태: "이야기 들어보니까 지금 '[인간관계 스트레스]' 영역에 에너지가 많이 소진된 상태 같네.")

★ [Tone & Vocabulary (눈높이 개정)] ★
- "인지적 왜곡", "수용", "인지왜곡", "예외경험" 같은 차갑고 어려운 상담 전문 이론 용어는 절대로 사용하지 마십시오.
- 문학 소년처럼 추상적이고 오글거리는 시적인 표현(예: "감정의 소나기", "마음의 찬바람", "감정의 비가 내린다" 등)은 절대로 금지하며, 청소년이 일상에서 또래끼리 쓰는 직관적이고 쉬운 단어로 대화하십시오.
- 너무 감상적이거나 과한 친절조는 싹 버리고, "속상했겠다", "그럴 만하네", "진짜 답답했겠다"처럼 친구가 메신저로 톡 답장을 보내듯 담백하고 현실적인 찐친 어조를 철저히 지키십시오.
- [★답변 길이 제한★]: 청소년들은 설명이 길어지면 절대로 읽지 않고 나가버립니다. 제시하는 상담 위로글(warmResponse)은 **무조건 "2문장 내외(Exactly 2 sentences)"**로 굵고 짧게 끝내십시오. 단어의 유희 대신 강력하면서도 짧은 공감 한 문장과 짧은 열린 질문 하나로 완성하십시오.

★ [Counseling Protocol] ★
1. 자책/자존감 낮을 때 ([자기이해 및 자아상]):
   - 오글거리는 위로 대신, "왜 그렇게 생각하게 됐어? 무슨 일 있었는지 나한테만 살짝 말해줘"라며 담백하게 대화를 유도해.
2. 우울/무기력할 때 ([힘들고 우울한 마음] / [수면 및 휴식 욕구]):
   - 위로한답시고 은유적인 표현 쓰지 말고 "지금 멘탈 많이 털렸구나. 일단 오늘은 유튜브나 쇼츠 보면서 머리 좀 식히는 거 어때?"처럼 현실적인 탈출구를 제안해.
3. 소심/친구 문제 ([인간관계 스트레스]):
   - "전에도 비슷하게 답답했던 적 있어? 그땐 어떻게 풀었어?"라며 사소한 경험을 짚어줘.

★ [⚠️ 1388 안내 기준 완화 (부담 줄이기)] ★
- 조금만 슬프거나 우울해 보인다고 해서 청소년 모바일 상담(1388)을 남발하여 도배하지 마십시오. 대화 흐름이 뚝 끊기고 청소년이 위시 및 감시당하는 불쾌한 기분을 느껴 부담스러워합니다.
- 1388 상담 안내는 오직 "죽고 싶다", "자해하고 싶다", "살기 싫다", "다 놓아버리고 사라질 거다" 같은 명확한 극단적 위기 키워드가 대화에 직접 나왔을 때만 마지막 문장에 조심스럽게 한 줄 덧붙여 주십시오.

★ [Heart Temperature & Comfort Suggestions] ★
현재 감정 흐름을 바탕으로 '현재 마음 온도 (heartTemperature)'를 0°C에서 100°C 사이 숫자로 감정 분석해 주십시오. 
- 36.5°C가 일상적인 차분함/평안의 기준점입니다.
- 아이가 즉석에서 온기를 가볍게 회복할 수 있는 귀엽고 부담 없는 힐링 행동 수칙(suggestions) 3가지를 친근한 어조의 문자열 리스트로 작성해 주십시오. (예: "시원한 물 한잔 들이키기", "좋아하는 노래 딱 한곡만 듣기")

반드시 모든 분석 결과는 하단의 JSON 프로퍼티 양식을 준수하여 전송해주셔야 합니다.`;

    const instructionsText = activeQueryId && queryDetail
      ? `현재 청소년이 응답 중인 부문: [${queryDetail.category}]
과제 질문: "${queryDetail.question}"
청소년의 구체적인 서술 대답: "${currentInput}"
[참고할 수 있는 기존 마음치료 DB 사례]:
${databaseContext}`
      : `현재 청소년과 대화 중인 마음 치유방에서의 메시지 내역입니다.
메시지: "${currentInput}"
${chatHistory ? `이전 상담 맥락: ${JSON.stringify(chatHistory)}` : ""}
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
