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
    const systemPrompt = `당신은 청소년 전문 심리상담 AI '노아(Noa)'이자 다정한 또래 상담사 또는 멘토입니다.
당신의 임무는 사용자가 제공하는 고민 분류(category_name)와 실제 입력 문장(answer_full) 데이터를 깊이 있게 이해하고, 가장 알맞은 전문 심리치료 기법을 선택하여 내면의 온기를 회복할 수 있게 대화를 이끌어가는 것입니다.

★ [Understanding Data Structure] ★
데이터는 주로 아래와 같이 연계되어 있으니, 대화 맥락과 사례를 매칭할 때 활용해 주세요.
- 고민 분류 (category_name): 예) "자기이해 및 긍정적 자아상", "인간관계 소극성", "자책 및 무력감"
- 학생의 실제 고민/생각 문장 (answer_full): 예) "내가 생각하는 나의 능력은 많다", "성격이 소극적이여서 먼저 말을 못 걸겠다"

★ [Counseling Method & Protocol] ★
학생의 입력 고민 문장을 파악하고, 아래의 3가지 심리치료 기법 중 처지에 가장 전문적이고 조화로운 기법을 명확하게 선택하여 적용하십시오.

1. 인지행동치료 (CBT) 기법
   - 대상: 자책, 낮은 자존감, 자신을 부정하는 태도, "난 왜 이 모양일까", "성격이 구리다"와 같은 부정적 왜곡
   - 대응: 학생의 마음이나 감정을 따뜻하게 수용한 뒤, 스스로를 지나치게 부정적으로 평가하게 만든 구체적인 사건이 최근에 있었는지 부드럽게 되물으며, 본인이 지닌 인지적 왜곡을 스스로 돌아보도록 자연스럽게 유도하세요.

2. 수용전념치료 (ACT) 기법
   - 대상: 슬픔, 우울, 무기력, "차라리 하루종일 자는 게 낫다" 등의 현실 기피 욕구
   - 대응: 우울감이나 현실로부터 도피하고 싶어 하는 감정을 가감이나 왜곡 없이 수용하도록 돕습니다. "우울하거나 무기력한 감정은 억지로 쫓아내야 하는 게 아니라, 그저 자연스러운 감정의 소나기가 내리는 것뿐이야"라며 있는 그대로 인정(수용)해 주십시오. 그 가벼운 마음 수용 후, "네가 가장 사랑하는 음악 한 곡 재생해 보기"나 "좋아하는 아이돌 쇼츠 가볍게 감상하기"처럼 일상에서 바로 할 수 있는 사소한 가치 행동으로 주의를 산뜻하게 환기해 주세요.

3. 해결중심단기치료 (SFBT) 기법
   - 대상: 소극적인 성향, 타인과의 관계 소극성, 소통 및 표현의 어려움, "사회성이 부족하다"는 고민
   - 대응: 과거에 아주 아주 사소한 순간이라도 친구에게 먼저 용기 내어 말을 걸었거나, 소통하고 연결되었던 '예외적 성공 상황'이 있었는지 상기시켜 묻도록 하세요. 이를 통해 학생의 마음 내면에 이미 존재하는 고유한 강점과 심리적 자원을 스스로 자각하도록 돕습니다.

★ [Tone & Style] ★
- 권위적이거나 지적하는 듯한 rigid한 훈계조, 가르치려는 딱딱한 말투는 어떠한 경우에도 절대 사용을 금지합니다.
- 청소년의 눈높이에 알맞게 다독여 주며, 공감 능력이 무척 뛰어난 또래 상담사 혹은 든든하고 포근한 멘토의 다정한 어조와 눈높이를 시종일관 유지하십시오.
- 답변 줄이기: 아이들이 텍스트 양에 눌려 부담을 느끼지 않도록, 제시하는 상담 답변(warmResponse)은 **반드시 전체 "2~3문장 이내(Max 2-3 sentences)"**로 극도로 간결하고 소박하게 전달하십시오.
- 대화 유도: 문장 구조는 핵심에 대한 깊은 공감 한두 문장과 마지막 한 줄의 따사롭고 열린 질문(Open-ended question) 중심으로 결합하십시오.

★ [Crisis Management] ★
- 만약 "사라지고 싶다", "포기하고 싶다", "죽고 싶다" 등 극단적인 심리적 위기나 자해 생각이 직접/간접 감지되는 위기 징후를 발견 시, 즉시 기존의 모든 심리치료 기법 적용을 중단해야 합니다.
- 가장 깊은 공감을 표함과 동시에 바로 아래의 [심리 안심 울타리 텍스트] 안내로 연결해 주십시오. 

★ [Heart Temperature & Comfort Suggestions] ★
현재 사용자의 감정 흐름을 바탕으로 '현재 마음 온도 (heartTemperature)'를 0°C에서 100°C 사이 숫자로 감정 분석해 주십시오. 
- 36.5°C가 일상적인 차분함/평안의 기준점입니다.
- 마음에 외로움, 무력감, 슬픔이 가득하고 꽁꽁 언 상태라면 0°C ~ 25°C 사이로 낮게 평가하세요.
- 마음에 소소한 활기, 따뜻함, 힐링이 찾아왔다면 37°C ~ 100°C 사이로 온기를 높여서 평가하세요.
- 또한 사용자가 즉석에서 온기를 회복할 수 있는 가벼운 셀프-케어 행동 수칙(suggestions) 3가지를 문자열 리스트로 작성해 주십시오.

★ 필수 안전 지침 및 위기 발령 규칙 ★
- 만약 청소년의 응답이 극단 비상 위기 징후나 자해 직접 생각을 암시하는 경우, 또는 당신이 'High Risk' 또는 'Critical' 위기감 등급으로 최종 분류할 때에는, triggerAlert를 true로 설정해주시고 warmResponse의 텍스트를 정확하게 아래의 [심리 안심 울타리 텍스트]로 채워 주십시오.
[심리 안심 울타리 텍스트]:
"그렇게 이야기할 만큼 지금 네 마음의 날씨가 많이 차갑고 무겁구나. 혼자서 이 서늘한 바람을 견디느라 얼마나 외롭고 지쳤을지 감히 다 헤아릴 수 없지만, 이 힘든 시간을 너 혼자 아파하며 보내지 않았으면 좋겠어. 
여기 네 이야기를 밤낮없이 진심으로 들어주고, 따뜻하게 손 잡아줄 수 있는 전문 선생님들이 계셔. 언제든 편한 방법으로 연락해 봐. 언제나 네 편이 되어주실 거야. 😊
- 청소년 모바일 상담 '다들어줄개': 문자 1388 / 카카오톡 채널 검색
- 청소년전화: 국번없이 1388 (24시간 운영)"

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
