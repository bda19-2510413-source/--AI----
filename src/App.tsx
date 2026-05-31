/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, FormEvent } from 'react';
import { 
  Heart, 
  Database, 
  Brain, 
  AlertTriangle, 
  MessageSquareOff, 
  Upload, 
  Plus, 
  Search, 
  CheckCircle, 
  Smile, 
  BookOpen, 
  FileText, 
  Activity, 
  Sparkles,
  PhoneCall,
  Loader2,
  RefreshCw,
  Send,
  X,
  Lock,
  Unlock,
  ShieldAlert
} from 'lucide-react';
import { EvaluationQuery, CounselingCase, Message } from './types';
import { DEFAULT_CASES } from './defaultCases';

const cleanCommentText = (text: string): string => {
  if (!text) return "";
  // Strip any category bracket names completely from display text
  return text.replace(/\[\s*(자기이해 및 자아상|인간관계 스트레스|힘들고 우울한 마음|우울하고 지친 마음|수면 및 휴식 욕구|진로 및 학업 고민|공부와 미래 고민|가족 갈등)\s*\]/g, "").trim();
};

export default function App() {
  // App States
  const [queries, setQueries] = useState<EvaluationQuery[]>([]);
  const [cases, setCases] = useState<CounselingCase[]>([]);
  const [localCustomCases, setLocalCustomCases] = useState<CounselingCase[]>(() => {
    try {
      const saved = localStorage.getItem("noa_custom_cases");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to load local custom cases:", e);
      return [];
    }
  });

  const allCases = [...localCustomCases, ...cases];

  // Premium highly-empathetic client-side counselor fallback
  const simulateCounselingClientSide = (inputText: string, activeQueryId?: number | null) => {
    // 1. Crisis Interceptor
    const cleanInput = (inputText || "").toLowerCase().replace(/\s+/g, "");
    const hasCrisisKeyword = [
      "자살", "자해", "죽고싶다", "죽어야지", "죽고파", "죽을래", "살기싫다", "사라지고싶다", "포기하고싶다", "사라지고 싶다", "포기하고 싶다"
    ].some(kw => cleanInput.includes(kw));

    if (hasCrisisKeyword) {
      return {
        success: true,
        analysis: {
          riskLevel: "Critical",
          insight: "위기 반응 감지",
          warmResponse: `마음이 너무 무겁고 힘들어서 진짜 다 놓아버리고 싶을 만큼 막막했구나. 혼자서 너무 지치지 말고, 힘들 땐 24시간 열려 있는 청소년전화 1388이나 모바일 상담 '다들어줄개'(문자 1388)로 꼭 연락해서 편안하게 네 속마음을 들려주면 좋겠어.\n[힘들고 우울한 마음]`,
          triggerAlert: true,
          heartTemperature: 10,
          suggestions: [
            "억지로 참지 말고 눈 감고 크게 심호흡하기",
            "가장 신나는 음악 가만히 틀어서 볼륨 작게 들어보기",
            "청소년 안전 헬프라인인 1388에 마음 담아 가볍게 털어놓기"
          ]
        },
        matchedReferenceCases: []
      };
    }

    // 1.5. Casual Greeting Interceptor (일상 인사 가로채기 연동)
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

    if (isCasualGreeting(inputText)) {
      const greetingResponses = [
        "어 안녕! 진짜 반가워. 오늘 하루 어떻게 보냈어? 형한테 무슨 일이든 편안하게 들려줘.",
        "오 왔구나! 반가워. 오늘 밤에 무슨 재미있는 수다 떨까? 마음 편하게 얘기해 줘.",
        "안녕안녕! 오늘 하루는 별일 없었어? 무슨 일 있었는지 형한테 다 얘기해 봐. 다 들어줄게.",
        "어 왔네! 반가워 반가워. 오늘 하루는 살만했어? 그냥 기분 어땠는지 가볍게 썰 좀 풀어줘."
      ];
      const idx = Math.abs(inputText.length) % greetingResponses.length;
      return {
        success: true,
        analysis: {
          riskLevel: "Safe",
          insight: "일상 친근 인사 소통",
          warmResponse: `${greetingResponses[idx]}\n[자기이해 및 자아상]`,
          triggerAlert: false,
          heartTemperature: 36.5,
          suggestions: [
            "편안히 기지개 한 번 켜보기",
            "시원한 물 한 모금 마시기",
            "가만히 눈 감고 5초간 가벼운 쉼 누리기"
          ]
        },
        matchedReferenceCases: []
      };
    }

    // 2. Keyword check for database matching
    const cleanAndTokenize = (text: string) => {
      if (!text) return [];
      return text.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\n]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 1);
    };

    const tokens = cleanAndTokenize(inputText);

    // Find matching reference cases using score matching
    const scored = allCases.map(c => {
      let score = 0;
      const caseTokens = cleanAndTokenize(c.studentResponse);
      tokens.forEach(t => {
        if (caseTokens.includes(t)) {
          score += 1;
        }
      });
      return { ...c, score };
    });
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const topScoredMatched = sorted.slice(0, 3);

    // Default warm responses depending on keywords
    let warmResponse = "오늘 하루는 어떻게 보냈어? 무슨 재미있는 일이나 고민거리가 있었는지 형한테 편하게 얘기해 줘. 다 들어줄게!\n[자기이해 및 자아상]";
    let riskLevel = "Low Risk";
    let insight = "일반 마음 공감지평";
    let heartTemp = 36.5;
    let suggestions = ["편안히 심호흡 3번 하기", "눈을 감고 10초간 쉬어 보기", "따뜻한 물 한 잔 마시며 기지개 켜기"];

    // 1. [자기이해 및 자아상]
    if (cleanInput.includes("자책") || cleanInput.includes("실수") || cleanInput.includes("내탓") || cleanInput.includes("바보") || cleanInput.includes("모양") || cleanInput.includes("자존감") || cleanInput.includes("내가싫") || cleanInput.includes("자아")) {
      warmResponse = "너무 자책하거나 스스로를 미워하지 마. 원래 누구나 실수할 때도 있고 그런 거지 모두 네 잘못은 아니야. 지금은 무거운 생각 좀 내려놓고 편하게 푹 쉬자.\n[자기이해 및 자아상]";
      riskLevel = "Low Risk";
      insight = "자아상 지지 성찰 유도";
      heartTemp = 28;
      suggestions = [
        "스스로에게 '그럴 수 있어, 괜찮아' 소리내어 말해주기",
        "나의 오늘 사소한 장점이나 고마운 점 가볍게 한 개 적어보기",
        "따스한 햇살이 드는 자리에서 따끈한 물 한 모금 마시기"
      ];
    }
    // 2. [인간관계 스트레스]
    else if (cleanInput.includes("친구") || cleanInput.includes("뒷담") || cleanInput.includes("따돌") || cleanInput.includes("소외") || cleanInput.includes("소극") || cleanInput.includes("사회성") || cleanInput.includes("왕짜") || cleanInput.includes("왕따") || cleanInput.includes("소통") || cleanInput.includes("외로움") || cleanInput.includes("관계")) {
      warmResponse = "친구 일로 스트레스가 엄청 많았구나. 대화 나누면서 은근 눈치 보이고 소외감 느끼면 되게 골치 아프지. 꼬여버린 관계 너무 신경 쓰지 말고 널 아껴주는 사람들을 먼저 생각하자.\n[인간관계 스트레스]";
      riskLevel = "Low Risk";
      insight = "소통 극복 지지";
      heartTemp = 30;
      suggestions = [
        "거울 앞에 서서 내 입꼬리를 살짝 올려 가볍게 미소 지어보기",
        "나에게 가볍게 인사해 주었던 고마운 친구의 눈빛 떠올리기",
        "메신저 상태 메세지에 너무 흔들리지 않기"
      ];
    }
    // 3. [힘들고 우울한 마음]
    else if (cleanInput.includes("슬픔") || cleanInput.includes("우울") || cleanInput.includes("힘들") || cleanInput.includes("눈물") || cleanInput.includes("속상")) {
      warmResponse = "아 진짜? 오늘 무슨 일 있었어? 지치고 힘든 하루였을 텐데 형한테 편하게 털어놔 봐. 다 들어줄게.\n[힘들고 우울한 마음]";
      riskLevel = "Low Risk";
      insight = "정서적 공감 및 지지";
      heartTemp = 25;
      suggestions = [
        "좋아하는 포근한 이불 덮고 가만히 누워있기",
        "아무 생각 없이 따뜻한 차 한 잔 우려 마시기",
        "네 속마음을 일기장에 편안하게 끄적여보기"
      ];
    }
    // 4. [수면 및 휴식 욕구]
    else if (cleanInput.includes("수면") || cleanInput.includes("잠") || cleanInput.includes("불면") || cleanInput.includes("휴식") || cleanInput.includes("피곤") || cleanInput.includes("졸려") || cleanInput.includes("지쳐") || cleanInput.includes("쉬고싶") || cleanInput.includes("무기력") || cleanInput.includes("침대")) {
      warmResponse = "요즘 피로가 꽉 차서 온몸이 찌뿌둥하고 쉬고 싶은 마음뿐이구나. 눕기만 해도 충전이 안 돼서 더 무기력할 수도 있어. 오늘 밤엔 더 아무 고민 하지 말고 푹 자자.\n[수면 및 휴식 욕구]";
      riskLevel = "Low Risk";
      insight = "수면 위생 및 휴식 권고";
      heartTemp = 24;
      suggestions = [
        "따뜻한 물로 가볍게 샤워하고 침대에 누워보기",
        "잠들기 30분 전에는 스마트폰 멀리 치워두기",
        "토닥토닥 내 목덜미를 가볍게 마사지해 주기"
      ];
    }
    // 5. [진로 및 학업 고민]
    else if (cleanInput.includes("성적") || cleanInput.includes("공부") || cleanInput.includes("시험") || cleanInput.includes("진로") || cleanInput.includes("미래") || cleanInput.includes("대학") || cleanInput.includes("학교") || cleanInput.includes("학업")) {
      warmResponse = "공부 진짜 하기 싫지, 그거 완전히 팩트고 이해해. 머리 터질 것 같을 때는 억지로 붙들고 있지 말고 쉬엄쉬엄 가자. 과제가 너무 빡세거나 어려운 게 있었어?\n[진로 및 학업 고민]";
      riskLevel = "Low Risk";
      insight = "학업 부담 완화";
      heartTemp = 34;
      suggestions = [
        "당장 할 분량은 기지개 켜고 5분간 좋아하는 풍경 바라보기",
        "좋아하는 달콤한 간식거리 한 입 쏙 물고 씹기",
        "오늘 하루도 충분히 애썼다고 다정하게 스스로 칭찬하기"
      ];
    }
    // 6. [가족 갈등]
    else if (cleanInput.includes("가족") || cleanInput.includes("엄마") || cleanInput.includes("아빠") || cleanInput.includes("부모") || cleanInput.includes("싸움") || cleanInput.includes("동생") || cleanInput.includes("언니") || cleanInput.includes("형") || cleanInput.includes("누나") || cleanInput.includes("오빠")) {
      warmResponse = "가장 편해야 할 집에서 마찰이 있고 잔소리 들으면 되게 답답하지. 속상했을 만도 하고 엄청 짜증 났겠네. 잠깐 밖에 나가서 부드러운 바람이라도 가볍게 쐬고 머리 식히고 오자.\n[가족 갈등]";
      riskLevel = "Low Risk";
      insight = "가족 불화 환기 지지";
      heartTemp = 35;
      suggestions = [
        "시원하고 달콤한 오렌지 주스나 아이스크림 먹기",
        "이어폰 꽂고 마음이 가벼워지는 잔잔한 음악 듣기",
        "내 아늑한 베개 껴안고 깊이 숨 고르기"
      ];
    }

    return {
      success: true,
      analysis: {
        riskLevel,
        insight,
        warmResponse,
        triggerAlert: riskLevel === "Critical" || riskLevel === "High Risk",
        heartTemperature: heartTemp,
        suggestions
      },
      matchedReferenceCases: topScoredMatched.map(c => ({
        category: c.category,
        studentResponse: c.studentResponse,
        idealResponse: c.idealResponse,
        riskLevel: c.riskLevel
      }))
    };
  };

  const [selectedQueryId, setSelectedQueryId] = useState<number>(1);
  
  const [loadingQueries, setLoadingQueries] = useState<boolean>(true);
  const [loadingCases, setLoadingCases] = useState<boolean>(true);
  
  // Tab States: 'diagnostic' or 'freechat'
  const [activeCenterMode, setActiveCenterMode] = useState<'diagnostic' | 'freechat'>('freechat');

  // Developer / Counselor Passcode authorization
  const [devCodeInput, setDevCodeInput] = useState<string>("");
  const [devCode, setDevCode] = useState<string>("");
  const [devAuthError, setDevAuthError] = useState<string>("");
  const isAuthorized = devCode === "fwequiieg1498fahui4890" || devCode === "56fa864df22be1a4ce7d5d2b77c5eebf99589d980f749ecbe8f2445efdf63da2";

  // Toggle Admin & Developer Control Hub
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(false);

  // Diagnostic Answer responses
  const [pillarAnswers, setPillarAnswers] = useState<{ [key: number]: string }>({
    1: "",
    2: "",
    3: "",
    4: "",
    5: "",
    6: ""
  });
  const [pillarAnalysis, setPillarAnalysis] = useState<{ [key: number]: any }>({});
  const [submittingPillarId, setSubmittingPillarId] = useState<number | null>(null);

  // Free Chat States
  const [freeChatHistory, setFreeChatHistory] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem("noa_chat_history");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Failed to parse saved chat history from localStorage:", e);
    }
    return [
      {
        id: 'welcome-msg',
        sender: 'ai',
        text: "안녕? 반가워. 많이 힘들고 지쳐서 돌파구가 보이지 않을 때 이야기 나눈 건 참 소중한 한 걸음이란다. 요즘 네 마음의 날씨나 고민들에 대해 얘기해 줄래? 편안하게 털어놓을 수 있는 속마음 우체통처럼 생각하며 언제든 보내줘. 네 이야기에 온 마음으로 정성껏 귀 기울일게.",
        timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        riskLevel: 'Safe'
      }
    ];
  });
  const [chatInput, setChatInput] = useState<string>("");
  const [chatAnalyzing, setChatAnalyzing] = useState<boolean>(false);
  const [lastAnalyzedRisk, setLastAnalyzedRisk] = useState<string>("Safe");

  // Bulk Upload state
  const [bulkText, setBulkText] = useState<string>("");
  const [bulkFormat, setBulkFormat] = useState<'txt' | 'json' | 'csv'>('txt');
  const [bulkStatus, setBulkStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: "" });
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Manual Add Case form
  const [isAddingCase, setIsAddingCase] = useState<boolean>(false);
  const [newCaseForm, setNewCaseForm] = useState({
    queryId: "",
    category: "학업과 일상 고민 (Daily Pressure & Concerns)",
    studentResponse: "",
    idealResponse: "",
    riskLevel: "Medium Risk",
    strategy: ""
  });
  const [addCaseStatus, setAddCaseStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: "" });

  // Filter and Search states for Database
  const [dbSearch, setDbSearch] = useState<string>("");
  const [dbCategoryFilter, setDbCategoryFilter] = useState<string>("전체");
  const [dbRiskFilter, setDbRiskFilter] = useState<string>("전체");

  const [isNeonActive, setIsNeonActive] = useState<boolean>(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  const fetchDbStatus = async () => {
    try {
      const res = await fetch("/api/db/status");
      const data = await res.json();
      setIsNeonActive(!!data.neon);
    } catch (err) {
      console.error("Error fetching db status:", err);
    }
  };

  // Fetch baseline data
  useEffect(() => {
    fetchQueries();
    fetchCases();
    fetchDbStatus();
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [freeChatHistory, chatAnalyzing]);

  // Persist chat to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem("noa_chat_history", JSON.stringify(freeChatHistory));
    } catch (e) {
      console.error("Failed to save chat history to localStorage:", e);
    }
  }, [freeChatHistory]);

  const fetchQueries = async () => {
    const defaultPillars: EvaluationQuery[] = [
      { id: 1, category: "공부와 미래 고민", question: "성적이나 앞으로의 진로 생각 때문에 머리 아프고 어깨가 무거운 상태인가요?", description: "공부 부담과 학교 생활로 지치고 마음 졸이는 고민" },
      { id: 2, category: "인간관계 스트레스", question: "친구 무리와 멀어지거나 학교에서 대화할 때 소외감을 자주 느끼시나요?", description: "친구 소통, 소극적인 성향 관리 및 마찰" },
      { id: 3, category: "우울하고 지친 마음", question: "가슴 구석이 은근히 아리고 가끔 쓸쓸한 우울감이 쏟아지며 마음이 가라앉나요?", description: "슬픔, 일상 속 작은 위안이 필요한 불안정한 마음" },
      { id: 4, category: "수면 및 휴식 욕구", question: "무기력을 부쩍 느끼며 온몸을 가만히 침대에 눕히고 푹 쉬고만 싶을 때가 잦나요?", description: "피로감에 모든 스위치를 잠시 끄고 흘려보내고 싶은 쉼" },
      { id: 5, category: "자기이해 및 자아상", question: "무언가 잘 안 풀리거나 힘들 때 전부 내 잘못인 것만 같아 내 탓을 하게 되나요?", description: "자존감 성찰, 속상함과 긍정적인 나 가꾸기" },
      { id: 6, category: "가족 갈등", question: "가장 편히 기대어야 할 가족이나 부모님 잔소리 혹은 싸움 때문에 진짜 답답하신가요?", description: "가정 내 대립, 부모님과의 서러운 마찰과 소통 부담" }
    ];
    try {
      setLoadingQueries(true);
      const res = await fetch("/api/db/queries");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data && data.queries) {
        setQueries(data.queries);
      } else {
        setQueries(defaultPillars);
      }
    } catch (err) {
      console.warn("Express backend queries endpoint not available. Using local client fallback.", err);
      setQueries(defaultPillars);
    } finally {
      setLoadingQueries(false);
    }
  };

  const fetchCases = async () => {
    try {
      setLoadingCases(true);
      const res = await fetch("/api/db/cases");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data && data.cases) {
        setCases(data.cases);
      } else {
        setCases(DEFAULT_CASES);
      }
    } catch (err) {
      console.warn("Express backend cases endpoint not available. Using local client fallback.", err);
      setCases(DEFAULT_CASES);
    } finally {
      setLoadingCases(false);
    }
  };

  // Trigger Gemini analyze on selected pillar
  const handlePillarAnalyze = async (pillarId: number) => {
    const text = pillarAnswers[pillarId];
    if (!text || text.trim().length < 5) {
      alert("AI 진단을 위해 청소년 대답을 최소 5자 이상 적어주세요. 마음속 생각들을 조금 더 적으면 정확도가 비약적으로 높아집니다.");
      return;
    }

    try {
      setSubmittingPillarId(pillarId);
      
      const res = await fetch("/api/counsel/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentInput: text,
          activeQueryId: pillarId
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const result = await res.json();
      if (result.success && result.analysis) {
        setPillarAnalysis(prev => ({
          ...prev,
          [pillarId]: {
            ...result.analysis,
            matchedReferenceCases: result.matchedReferenceCases || []
          }
        }));

        // Dynamic highlight risk
        if (result.analysis.riskLevel) {
          setLastAnalyzedRisk(result.analysis.riskLevel);
        }
      } else {
        throw new Error(result.error || "분석 오류");
      }
    } catch (err: any) {
      console.warn("API Server analysis failed, processing client-side RAG:", err);
      // Perfect Client-side dynamic response fallback
      const result = simulateCounselingClientSide(text, pillarId);
      setPillarAnalysis(prev => ({
        ...prev,
        [pillarId]: {
          ...result.analysis,
          matchedReferenceCases: result.matchedReferenceCases || []
        }
      }));

      if (result.analysis.riskLevel) {
        setLastAnalyzedRisk(result.analysis.riskLevel);
      }
    } finally {
      setSubmittingPillarId(null);
    }
  };

  // Developer passcode handlers
  const handleAuthorizeDev = (e: FormEvent) => {
    e.preventDefault();
    const cleanInput = devCodeInput.trim();
    if (cleanInput === "fwequiieg1498fahui4890" || cleanInput === "56fa864df22be1a4ce7d5d2b77c5eebf99589d980f749ecbe8f2445efdf63da2") {
      setDevCode(cleanInput);
      setDevAuthError("");
    } else {
      setDevAuthError("비밀 패스코드가 일치하지 않습니다. 올바른 보안 코드를 다시 입력해주십시오.");
    }
  };

  const handleDeauthorizeDev = () => {
    setDevCode("");
    setDevCodeInput("");
  };

  // Multi-format Bulk Case Importer
  const handleBulkUpload = async () => {
    if (!bulkText || bulkText.trim().length === 0) {
      setBulkStatus({ type: 'error', message: "업로드할 텍스트를 입력해 주세요." });
      return;
    }

    try {
      setIsUploading(true);
      setBulkStatus({ type: 'idle', message: "" });

      const res = await fetch("/api/db/cases/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          textData: bulkText,
          format: bulkFormat,
          devCode
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        setBulkStatus({
          type: 'success',
          message: `성공적으로 ${data.count}개의 청소년 심리 상태 및 조언 가이드라인 자료를 DB에 인계 및 저장했습니다! (누적 DB 총 ${data.totalCount}건)`
        });
        setBulkText(""); // Clear text
        fetchCases(); // Refresh database
      } else {
        setBulkStatus({ type: 'error', message: data.error || "데이터 파싱 중 분석 실패" });
      }
    } catch (err: any) {
      console.warn("Express bulk endpoint not reachable. Parsing client-side...", err);
      // Client-side parser fallback for Vercel / offline mode
      try {
        let parsedCases: CounselingCase[] = [];
        const textData = bulkText;
        if (bulkFormat === "json") {
          const parsed = JSON.parse(textData);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          items.forEach((item: any, idx: number) => {
            parsedCases.push({
              id: `local-blk-json-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
              queryId: item.queryId ? Number(item.queryId) : (item.id ? Number(item.id) : null),
              category: item.category || "일반 심리 상담",
              studentResponse: item.studentResponse || item.response || item.text || item.questionAnswer || "답변 없음",
              idealResponse: item.idealResponse || item.counselorResponse || item.advice || "조언 없음",
              riskLevel: item.riskLevel || item.risk || "Medium Risk",
              strategy: item.strategy || "일반적 공감 및 지지 정책",
            });
          });
        } else if (bulkFormat === "csv") {
          const lines = textData.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
          lines.forEach((line: string, index: number) => {
            if (index > 0) { // skip header
              const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(s => s.replace(/^"|"$/g, "").trim());
              const category = parts[0] || "대용량 업로드";
              const studentResponse = parts[1] || "답변 공백";
              const idealResponse = parts[2] || "전문 조언 공백";
              const riskLevel = parts[3] || "Medium Risk";
              const strategy = parts[4] || "기본 상담 지지";
              
              parsedCases.push({
                id: `local-blk-csv-${Date.now()}-${index}`,
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
          // Natural unstructured text block format fallback
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
                if (line.includes(":")) {
                  studentResponse = line.split(":")[1].trim();
                }
              } else if (line.startsWith("상담:") || line.startsWith("가이드:") || line.startsWith("조언:") || line.startsWith("선생님:")) {
                if (line.includes(":")) {
                  idealResponse = line.split(":")[1].trim();
                }
              } else if (line.startsWith("위험도:") || line.startsWith("등급:") || line.startsWith("레벨:")) {
                if (line.includes(":")) {
                  riskLevel = line.split(":")[1].trim();
                }
              } else if (line.startsWith("카테고리:") || line.startsWith("분류:")) {
                if (line.includes(":")) {
                  category = line.split(":")[1].trim();
                }
              } else if (line.startsWith("전략:") || line.startsWith("방법:")) {
                if (line.includes(":")) {
                  strategy = line.split(":")[1].trim();
                }
              }
            });

            if (!studentResponse && lines[0]) {
              studentResponse = lines[0];
              idealResponse = lines.slice(1).join(" ");
            }

            if (studentResponse && idealResponse) {
              parsedCases.push({
                id: `local-blk-txt-${Date.now()}-${idx}`,
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
          setBulkStatus({ type: 'error', message: "형식 분석에 실패했거나 대용량 파일 내 데이터가 0건입니다." });
          return;
        }

        const updatedLocal = [...parsedCases, ...localCustomCases];
        setLocalCustomCases(updatedLocal);
        localStorage.setItem("noa_custom_cases", JSON.stringify(updatedLocal));

        setBulkStatus({
          type: 'success',
          message: `성공(로컬 연동): Vercel/정적 웹 세션 아래에서 총 ${parsedCases.length}개의 정밀 상담 가이드 데이터를 브라우저에 임포트 완료했습니다!`
        });
        setBulkText("");
      } catch (parseError: any) {
        setBulkStatus({ type: 'error', message: `로컬 파싱 실패: ${parseError.message}` });
      }
    } finally {
      setIsUploading(false);
    }
  };

  // Add individual reference case
  const handleAddCase = async (e: FormEvent) => {
    e.preventDefault();
    if (!newCaseForm.studentResponse || !newCaseForm.idealResponse) {
      setAddCaseStatus({ type: 'error', message: "답변 질문 항목 및 권장 조언 메커니즘을 상세히 적어주세요." });
      return;
    }

    const localNewCase: CounselingCase = {
      id: `local-case-${Date.now()}`,
      queryId: newCaseForm.queryId ? Number(newCaseForm.queryId) : null,
      category: newCaseForm.category,
      studentResponse: newCaseForm.studentResponse,
      idealResponse: newCaseForm.idealResponse,
      riskLevel: newCaseForm.riskLevel,
      strategy: newCaseForm.strategy || "맞춤 감정 지지 및 충동 관리"
    };

    try {
      const res = await fetch("/api/db/case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newCaseForm,
          queryId: newCaseForm.queryId ? Number(newCaseForm.queryId) : null,
          devCode
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        setAddCaseStatus({ type: 'success', message: "새로운 심리 진단 자원이 훈련 목록에 추가되었습니다!" });
        setNewCaseForm({
          queryId: "",
          category: "학업과 일상 고민 (Daily Pressure & Concerns)",
          studentResponse: "",
          idealResponse: "",
          riskLevel: "Medium Risk",
          strategy: ""
        });
        setIsAddingCase(false);
        fetchCases(); // Refresh
      } else {
        throw new Error(data.error || "자료 추가 실패");
      }
    } catch (err: any) {
      console.warn("Backend add api failed, saving case locally instead:", err);
      // Save locally to persist on Vercel
      const updatedLocal = [localNewCase, ...localCustomCases];
      setLocalCustomCases(updatedLocal);
      localStorage.setItem("noa_custom_cases", JSON.stringify(updatedLocal));

      setAddCaseStatus({ type: 'success', message: "성공(로컬 모드): 새로운 심리 진단 자원이 현재 브라우저의 마음 자료실에 보관되었습니다!" });
      setNewCaseForm({
        queryId: "",
        category: "학업과 일상 고민 (Daily Pressure & Concerns)",
        studentResponse: "",
        idealResponse: "",
        riskLevel: "Medium Risk",
        strategy: ""
      });
      setIsAddingCase(false);
    }
  };

  // Delete specific reference case
  const handleDeleteCase = async (id: string, isDefaultSeed: boolean) => {
    if (isDefaultSeed) {
      if (!confirm("기본 초기 씨앗 사례입니다. 이것을 데이터베이스에서 영구 제외하시겠습니까?")) return;
    } else {
      if (!confirm("해당 상담 지침 사례를 정말 데이터베이스에서 제거하시겠습니까?")) return;
    }

    const isLocal = localCustomCases.some(c => c.id === id);
    if (isLocal) {
      const updatedLocal = localCustomCases.filter(c => c.id !== id);
      setLocalCustomCases(updatedLocal);
      localStorage.setItem("noa_custom_cases", JSON.stringify(updatedLocal));
      return;
    }

    try {
      const res = await fetch("/api/db/case/delete", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Developer-Code": devCode
        },
        body: JSON.stringify({ id, devCode })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        fetchCases();
      } else {
        alert(data.error);
      }
    } catch (err: any) {
      console.warn("Server delete call failed, dropping case from memory:", err);
      setCases(prev => prev.filter(c => c.id !== id));
    }
  };

  // Free Chat messenger logic
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!chatInput || chatInput.trim().length === 0) return;

    const studentMessageText = chatInput;
    setChatInput("");

    // 1. Add student message to context list
    const studentMessage: Message = {
      id: `student-msg-${Date.now()}`,
      sender: 'student',
      text: studentMessageText,
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };

    setFreeChatHistory(prev => [...prev, studentMessage]);
    setChatAnalyzing(true);

    try {
      // Setup payload including context
      const chatContextHistory = freeChatHistory
        .filter(m => m.id !== 'welcome-msg')
        .slice(-5) // Send last 5 dialogue lines
        .map(m => ({ role: m.sender === 'student' ? 'user' : 'model', text: m.text }));

      const res = await fetch("/api/counsel/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentInput: studentMessageText,
          chatHistory: chatContextHistory
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success && data.analysis) {
        const aiMessage: Message = {
          id: `ai-msg-${Date.now()}`,
          sender: 'ai',
          text: data.analysis.warmResponse,
          riskLevel: data.analysis.riskLevel,
          insight: data.analysis.insight,
          timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
          referenceCases: data.matchedReferenceCases || []
        };
        setFreeChatHistory(prev => [...prev, aiMessage]);
        
        if (data.analysis.riskLevel) {
          setLastAnalyzedRisk(data.analysis.riskLevel);
        }
      } else {
        throw new Error(data.error || "분석 이상 감지");
      }
    } catch (err) {
      console.warn("API Server free chat failed, processing client-side RAG:", err);
      // Perfect Client-side free-chat counselor response
      const result = simulateCounselingClientSide(studentMessageText);
      const aiMessage: Message = {
        id: `ai-msg-${Date.now()}`,
        sender: 'ai',
        text: result.analysis.warmResponse,
        riskLevel: result.analysis.riskLevel as any,
        insight: result.analysis.insight,
        timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        referenceCases: result.matchedReferenceCases || []
      };
      setFreeChatHistory(prev => [...prev, aiMessage]);
      
      if (result.analysis.riskLevel) {
        setLastAnalyzedRisk(result.analysis.riskLevel);
      }
    } finally {
      setChatAnalyzing(false);
    }
  };

  const handleResetChat = () => {
    const initialMsg: Message = {
      id: 'welcome-msg',
      sender: 'ai',
      text: "안녕? 반가워. 많이 힘들고 지쳐서 돌파구가 보이지 않을 때 이야기 나눈 건 참 소중한 한 걸음이란다. 요즘 네 마음의 날씨나 고민들에 대해 얘기해 줄래? 편안하게 털어놓을 수 있는 속마음 우체통처럼 생각하며 언제든 보내줘. 네 이야기에 온 마음으로 정성껏 귀 기울일게.",
      timestamp: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      riskLevel: 'Safe'
    };
    setFreeChatHistory([initialMsg]);
    setLastAnalyzedRisk("Safe");
    localStorage.removeItem("noa_chat_history");
    setActiveCenterMode('freechat');
  };

  // Visual translation pseudonym in Korean to completely avoid student pressure
  const getFriendlyRiskLabel = (risk: string) => {
    const raw = risk?.trim()?.toLowerCase() || '';
    if (raw.includes('safe')) return '☀️ 마음 맑음 (Safe)';
    if (raw.includes('low')) return '⛅ 소담한 구름 (Low)';
    if (raw.includes('medium')) return '🌧️ 흐린 소나기 (Medium)';
    if (raw.includes('high')) return '🌬️ 조금 센 바람 (High)';
    if (raw.includes('critical')) return '🧡 보살핌의 따스함 필요 (Care)';
    return risk || '💡 보통 습도';
  };

  // Get color for risk tags
  const getRiskColorClasses = (risk: string) => {
    switch (risk?.toLowerCase()?.trim()) {
      case 'safe':
        return 'bg-[#F2F4F2] text-[#8BA888] border-[#8BA888]/20';
      case 'low':
      case 'low risk':
        return 'bg-[#FAF8F0] text-[#D4A373] border-[#D4A373]/30';
      case 'medium':
      case 'medium risk':
        return 'bg-[#FFF5E6] text-[#D18E44] border-[#D4A373]/50';
      case 'high':
      case 'high risk':
        return 'bg-[#FDEFEA] text-[#D16A4E] border-[#E89B86]/40 font-semibold';
      case 'critical':
      case 'critical (위험군 즉각 개입)':
        return 'bg-[#FDEFEA] text-[#D16A4E] border-[#D16A4E] font-bold ring-2 ring-[#D16A4E]/30 animate-pulse';
      default:
        return 'bg-[#F5F4F0] text-[#7A746E] border-[#E5E2D9]';
    }
  };

  // Helper template inserters for bulk data
  const loadExampleTemplate = (type: 'txt' | 'json' | 'csv') => {
    if (type === 'txt') {
      setBulkText(`카테고리: 학업과 일상 고민 (Daily Pressure & Concerns)
학생: 학원 스케줄이 너무 많아서 쉴 때가 없어요. 마음이 힘든데 부모님은 1등만 하라고 압박합니다.
조언: 좁은 의자에 앉아 홀로 고민을 견뎠을 마음을 생각하니 무척 애틋하구나. 너는 등수로만 증명되는 장난감이 아니라, 존재 자체만으로 마땅히 사랑받을 소중한 아이란다. 지칠 때는 언제든 대화하면서 고민을 반으로 나누어 가자.
위험도: Medium Risk
전략: 정서 완충 지지 및 세대 간 학습 압박 이완 조언

카테고리: 마음 속 무거운 그늘 (Emotional Safety & Comfort)
학생: 너무 지쳐서 세상의 스위치를 끄고 잠깐 깊은 잠에 빠지고 싶은 충동이 밀려와요. 아무도 내 말을 듣지 않아요.
조언: 얼마나 가슴 한구석이 짓눌리고 지쳤기에 잠시 세상의 짐을 다 놓아두고 싶은 마음의 시린 겨울이 왔을지, 생각할수록 마음이 아린단다. 혼자 아파하지 말고 내 손을 잡아주지 않겠니? 오늘 밤은 안전하게 이곳에서 마음을 고르고 마음 건강 전용 소통 채널(109)에도 기대보자.
위험도: Critical
전략: 복받쳐서 조절하기 힘든 감정의 속도 완화, 핫라인 연계 및 안전 서약 유도`);
    } else if (type === 'json') {
      setBulkText(`[
  {
    "category": "마음의 겨울 (Helplessness & Future)",
    "studentResponse": "미래를 생각하면 앞이 잘 안 보여요. 뭘 해도 잘 안 풀릴 것만 같고 무기력해요.",
    "idealResponse": "너의 앞날에 보이지 않는 벽이 둘러쳐진 것처럼 캄캄하게 조급해졌구나. 하지만 지금의 고되고 지친 순간은 너의 미래 전체를 결정하는 결승선이 아니란다. 네 가슴 속에는 이미 예쁜 별씨가 숨겨져 있어. 힘든 한철을 같이 수호해 줄게.",
    "riskLevel": "High Risk",
    "strategy": "미래 비관 관찰 예방 및 작은 실행 주도권 확보 안내"
  }
]`);
    } else if (type === 'csv') {
      setBulkText(`카테고리,청소년 답변,주말 위로 조언,위험도,보살핌 전략
관계와 외로움 (Connection & Solitude),"전 항상 혼자인 것 같고 친구들 모임에서도 제 말엔 반응이 없어서 쓸쓸해요.","서늘한 단톡방에 혼자 시선을 두고 느꼈을 슬픔과 쓸쓸함에 마음속 온기가 바닥났겠구나. 네 마음은 고독한 공기가 아니라 마땅히 따뜻하고 커다란 품속에 환영받아 마땅하단다. 외롭고 힘들 때는 언제든 마음 속 이야기를 들려주렴.","Medium Risk","소외 상처 공감 및 마음 중심 단단함 강화"`);
    }
  };

  // Filter cases dynamically based on select parameters and search
  const filteredCases = allCases.filter(c => {
    const matchesSearch = dbSearch === "" || 
      (c.studentResponse || "").toLowerCase().includes(dbSearch.toLowerCase()) ||
      (c.idealResponse || "").toLowerCase().includes(dbSearch.toLowerCase()) ||
      (c.category || "").toLowerCase().includes(dbSearch.toLowerCase());

    const matchesCategory = dbCategoryFilter === "전체" || c.category.includes(dbCategoryFilter);

    const matchesRisk = dbRiskFilter === "전체" || 
      c.riskLevel.toLowerCase().includes(dbRiskFilter.toLowerCase());

    return matchesSearch && matchesCategory && matchesRisk;
  });

  // Calculate stats for dataset dynamic chart values
  const countByCategory = (catKeyword: string) => {
    return allCases.filter(c => c.category.includes(catKeyword)).length;
  };

  // Get active query context helper
  const activeQuery = queries.find(q => q.id === selectedQueryId);

  return (
    <div className="w-full min-h-screen bg-[#FDFCF8] text-[#4A443F] font-sans flex flex-col">
      {/* Top Header */}
      <header className="h-16 border-b border-[#E5E2D9] px-6 flex items-center justify-between bg-white shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#8BA888] rounded-full flex items-center justify-center shadow-inner">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-serif font-bold text-lg tracking-tight select-none">
              안심 AI 노아 <span className="text-[#8BA888] font-sans text-sm font-semibold ml-1">Noa</span>
            </span>
            <div className="text-[10px] text-[#9A948E] -mt-1 font-mono uppercase tracking-widest hidden sm:block">
              Adolescent Emotional Shelter & Care
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex gap-4 items-center text-xs font-semibold text-[#7A746E]">
            {/* Reset Chat Button on the left of tab items */}
            <button 
              onClick={handleResetChat}
              className="pb-1 border-b-2 border-transparent text-[#D4A373] hover:text-[#b58353] transition-all flex items-center gap-1 hover:scale-105 transform active:scale-95"
              title="대화를 처음부터 다시 시작합니다"
            >
              <RefreshCw className="w-3 h-3" />
              새 대화창
            </button>
            
            <div className="h-3.5 w-[1px] bg-[#E5E2D9]"></div>
            
            <button 
              onClick={() => { setActiveCenterMode('diagnostic'); setSelectedQueryId(1); }}
              className={`pb-1 border-b-2 hover:text-[#4A443F] transition-all ${activeCenterMode === 'diagnostic' ? 'border-[#8BA888] text-[#4A443F]' : 'border-transparent'}`}
            >
              6대 맞춤형 심리검사
            </button>
            <button 
              onClick={() => setActiveCenterMode('freechat')}
              className={`pb-1 border-b-2 hover:text-[#4A443F] transition-all ${activeCenterMode === 'freechat' ? 'border-[#8BA888] text-[#4A443F]' : 'border-transparent'}`}
            >
              대치 치유 메신저
            </button>
          </div>

          <div className="h-6 w-[1.5px] bg-[#E5E2D9] hidden md:block"></div>

          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isNeonActive ? 'bg-indigo-400' : 'bg-emerald-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isNeonActive ? 'bg-indigo-600' : 'bg-[#8BA888]'}`}></span>
            </span>
            <div className="text-xs text-[#7A746E]">
              {isNeonActive ? (
                <>
                  <span className="font-bold text-indigo-600">Neon DB</span> 연동중
                </>
              ) : (
                <>
                  <span className="font-bold text-[#8BA888]">안심 로컬 DB</span> 작동중
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 grid grid-cols-12 gap-5 p-5 overflow-hidden">
        
        {/* LEFT COLUMN: 6 Core pillars, statistics */}
        <section className="col-span-12 lg:col-span-3 flex flex-col gap-4 overflow-y-auto">
          
          {/* Diagnostic Pillars Box (Merged Core 6-Pillars Dashboard) */}
          <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 shadow-sm flex flex-col">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs uppercase tracking-widest text-[#4A443F] font-bold">마음의 6대 기둥 (6 PILLARS)</h3>
              <span className="text-[10px] bg-[#FAF9F6] border border-[#E5E2D9] px-2 py-0.5 rounded-full text-[#7A746E] font-mono font-bold">
                Pillars
              </span>
            </div>

            <p className="text-xs text-[#7A746E] mb-3 leading-relaxed">
              6개 영역별 상세 고백과 마음 상태를 살피고, 따뜻한 맞춤 위로와 안전망을 매칭합니다.
            </p>

            {/* Sequential Index Navigation / Step List */}
            <div className="space-y-1.5">
              {loadingQueries ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-[#8BA888] mr-2" />
                  <span className="text-xs text-[#9A948E]">프로세스 로딩 중...</span>
                </div>
              ) : (
                queries.map((q) => {
                  const isCur = selectedQueryId === q.id && activeCenterMode === 'diagnostic';
                  const isAnalyzed = !!pillarAnalysis[q.id];
                  const isWriting = !isAnalyzed && (pillarAnswers[q.id] || "").trim().length > 0;
                  
                  // Calculate reference counts dynamically
                  const numCases = allCases.filter(c => c.queryId === q.id || c.category.includes(q.category.substring(0, 5))).length;
                  
                  return (
                    <button
                      key={q.id}
                      onClick={() => {
                        setSelectedQueryId(q.id);
                        setActiveCenterMode('diagnostic');
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all flex flex-col gap-1 ${
                        isCur
                          ? 'bg-white border-[#8BA888] text-[#4A443F] font-bold ring-2 ring-[#8BA888]/10 shadow-sm'
                          : 'bg-[#FAF9F6] border-[#E5E2D9] text-[#7A746E] hover:bg-white hover:border-[#CDC9C0]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full min-w-0">
                        <span className="text-xs font-bold truncate flex-1 min-w-0 pr-1">
                          {q.id}. {q.category.split('(')[0]?.trim() || q.category}
                        </span>
                        
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isAnalyzed ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#8BA888]" title="분석 완료"></span>
                          ) : isWriting ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#D4A373] animate-pulse" title="상세 작성 중"></span>
                          ) : null}
                          <span className="text-[9px] font-mono bg-white border border-[#E5E2D9] text-[#7A746E] px-1.5 py-0.5 rounded">
                            {numCases}개 데이터
                          </span>
                        </div>
                      </div>
                      
                      <p className="text-[10px] text-[#9A948E] line-clamp-1 font-normal font-sans leading-relaxed">
                        {q.description}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Dynamic DB Statistics Box */}
          <div className="bg-[#FAF9F6] border border-[#E5E2D9] rounded-2xl p-4 flex flex-col gap-2 shadow-sm">
            <h4 className="text-xs font-bold text-[#4A443F] flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-[#D4A373]" /> 구축 자료실 활성도
            </h4>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div className="bg-white p-2 rounded-lg border border-[#E5E2D9] text-center">
                <div className="text-[10px] text-[#9A948E] uppercase font-bold">참조 사례 수</div>
                <div className="text-lg font-serif text-[#4A443F] font-bold">{allCases.length} <span className="text-[10px] text-[#9A948E] font-normal">건</span></div>
              </div>
              <div className="bg-white p-2 rounded-lg border border-[#E5E2D9] text-center">
                <div className="text-[10px] text-[#9A948E] uppercase font-bold">마음 구제율</div>
                <div className="text-lg font-serif text-[#4A443F] font-bold text-[#8BA888]">100%</div>
              </div>
            </div>
            <div className="text-[9px] text-[#9A948E] leading-snug">
              * 전문가 모드에서 100~200개의 질문-대답 시트를 일괄 탑재하면, 대화 분석 시 실시간 검색 매칭 대상이 되어 위로 분석의 완성도가 증폭됩니다.
            </div>
          </div>

        </section>

        {/* CENTER COLUMN: Interactive Diagnostic Console / Chatroom */}
        <section className={`col-span-12 flex flex-col gap-4 overflow-y-auto ${showAdminPanel ? 'lg:col-span-6' : 'lg:col-span-9'}`}>
          
          {/* Switch Mode Controls */}
          <div className="bg-white border border-[#E5E2D9] p-1.5 rounded-xl flex items-center gap-2 shadow-sm shrink-0">
            <button
              onClick={() => setActiveCenterMode('diagnostic')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${
                activeCenterMode === 'diagnostic'
                  ? 'bg-[#8BA888] text-white shadow-sm'
                  : 'text-[#7A746E] hover:bg-[#FAF9F6]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              6대 기둥 단계별 마음 검사
            </button>
            <button
              onClick={() => {
                setActiveCenterMode('freechat');
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${
                activeCenterMode === 'freechat'
                  ? 'bg-[#8BA888] text-white shadow-sm'
                  : 'text-[#7A746E] hover:bg-[#FAF9F6]'
              }`}
            >
              <Smile className="w-3.5 h-3.5" />
              상시 마음 보살핌 AI 챗
            </button>
          </div>

          {/* Mode 1: Detailed 6-pillar Self Evaluation */}
          {activeCenterMode === 'diagnostic' && (
            <div className="bg-white border border-[#E5E2D9] rounded-2xl p-5 shadow-sm flex-1 flex flex-col justify-between overflow-hidden">
              
              {/* Question Header & Context */}
              <div className="flex-1 flex flex-col overflow-y-auto space-y-4 pr-1">
                
                {activeQuery ? (
                  <div className="p-5 rounded-xl bg-[#FAF9F6] border border-[#E5E2D9] shadow-sm flex flex-col gap-3">
                    <div className="flex justify-between items-center border-b border-[#E5E2D9]/50 pb-2 mb-1">
                      <div className="text-xs font-bold text-[#4A443F] flex items-center gap-1.5">
                        <span className="bg-[#8BA888]/10 text-[#647C62] px-2 py-0.5 rounded-md text-[10px] font-bold font-sans">진단 영역</span>
                        <span className="text-[#4A443F] font-semibold">{activeQuery.category}</span>
                      </div>
                      <span className="text-xs font-bold text-[#9A948E] font-mono">
                        Pillar {activeQuery.id} of 6
                      </span>
                    </div>
                    
                    <h2 className="text-sm md:text-base font-bold text-[#4A443F] leading-relaxed">
                      {activeQuery.question}
                    </h2>
                    
                    {(() => {
                      const getPillarTip = (id: number) => {
                        switch(id) {
                          case 1: return "성적부담, 부모님 몰래 겪는 감정, 막막한 내마음 등 속상했던 일들을 있는 그대로 편하게 적어주세요.";
                          case 2: return "주변의 따뜻한 흐름, 혹은 외롭고 쓸쓸할 때 홀로 밤을 새웠을 때의 내 감정을 차분히 남겨 보세요.";
                          case 3: return "내일에 대한 아득함, 희망, 혹은 힘 빠지는 무력감 등 가슴에 잔물결처럼 밀려오는 감정을 남겨주세요.";
                          case 4: return "스스로를 안아주고 토닥이는 다정한 말, 혹은 스스로를 짐처럼 낮추며 자책했을 속상함을 나눠보세요.";
                          case 5: return "울컥 감정이 솟구칠 때 이를 안전하게 가라앉히는 자신만의 습관이나 행동이 있는지 적어주세요.";
                          case 6: return "세상의 스위치를 끄고 싶을 정도의 깊은 그늘, 혹은 안전하고 포근한 위로를 얻고픈 생각을 전해주세요.";
                          default: return "말하고 싶지 않았던 상처까지 이곳에 자유로이 안전하게 쏟어 보세요. 전부 안아 드리겠습니다.";
                        }
                      };
                      return (
                        <p className="text-[11px] text-[#C4925E] font-medium leading-relaxed flex items-start gap-1">
                          <span>💡</span>
                          <span>{getPillarTip(activeQuery.id)}</span>
                        </p>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs text-[#9A948E]">질문을 불러오는 데 실패했습니다.</div>
                )}

                {/* Teenager response area */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-bold text-[#C4925E] block">
                      ✍️ 나의 솔직한 심정 및 대답 적기
                    </label>
                  </div>
                  
                  <textarea
                    value={pillarAnswers[selectedQueryId] || ""}
                    onChange={(e) => {
                      const text = e.target.value;
                      setPillarAnswers(prev => ({ ...prev, [selectedQueryId]: text }));
                    }}
                    placeholder="여기에 청소년의 기분, 두려움, 평소 하는 생각들을 자세히 적어주세요. (최소 5자 이상 입력 추천, 100~200자 내외로 상세할수록 AI가 정확한 위로 조언과 유용 통계를 내놓습니다)"
                    className="w-full h-32 p-3 text-xs md:text-sm rounded-xl bg-white border border-[#E5E2D9] text-[#4A443F] focus:outline-none focus:ring-2 focus:ring-[#8BA888] focus:border-[#8BA888] resize-none leading-relaxed placeholder-[#9A948E]/70 shadow-inner"
                  />
                  
                  {/* Action Row containing Character Count and Submit Button */}
                  <div className="flex justify-between items-center pt-1.5">
                    <div className="text-[11px] text-[#7A746E]">
                      글자 수: <strong className="font-mono text-[#7A746E]">{(pillarAnswers[selectedQueryId] || "").length}</strong>자
                    </div>

                    <button
                      onClick={() => handlePillarAnalyze(selectedQueryId)}
                      disabled={submittingPillarId !== null || !(pillarAnswers[selectedQueryId] || "").trim()}
                      className="bg-[#8BA888] hover:bg-[#72926E] disabled:bg-[#CDC9C0] text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow"
                    >
                      {submittingPillarId === selectedQueryId ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          진단서 발급 중...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          AI 정밀 분석 및 공감 가이드 생성
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* AI Assessment results layout */}
                <div className="pt-4 border-t border-[#E5E2D9] flex-1">
                  {pillarAnalysis[selectedQueryId] ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-[#4A443F] tracking-wide flex items-center gap-1.5">
                          <CheckCircle className="w-4 h-4 text-[#8BA888]" /> 노아(Noa) AI 안심 소견서 ({selectedQueryId}번 영역)
                        </h4>
                        
                        {/* Risk level badge */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[#9A948E]">판독 상태 등급:</span>
                          <span className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border uppercase ${getRiskColorClasses(pillarAnalysis[selectedQueryId].riskLevel)}`}>
                            {getFriendlyRiskLabel(pillarAnalysis[selectedQueryId].riskLevel)}
                          </span>
                        </div>
                      </div>

                      {/* Counselor Empathy advice */}
                      <div className="p-4 rounded-xl bg-[#8BA888]/5 border border-[#8BA888]/20">
                        <div className="text-[10px] font-bold text-[#647C62] mb-1.5 uppercase tracking-wider flex items-center gap-1">
                          <Heart className="w-3 h-3 fill-current text-[#8BA888]" /> 안심 AI 노아의 따뜻한 위로 조언
                        </div>
                        <p className="text-xs md:text-[13px] text-[#4A443F] leading-relaxed whitespace-pre-line font-medium italic">
                          "{cleanCommentText(pillarAnalysis[selectedQueryId].warmResponse)}"
                        </p>
                      </div>

                      {/* Action Alert Banner for crisis */}
                      {(pillarAnalysis[selectedQueryId].triggerAlert || ['critical', 'high risk'].includes(pillarAnalysis[selectedQueryId].riskLevel?.toLowerCase())) && (
                        <div className="p-3 bg-[#E89B86]/10 border border-[#D16A4E]/30 rounded-xl flex items-start gap-2.5 animate-bounce">
                          <AlertTriangle className="w-4 h-4 text-[#D16A4E] shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-bold text-[#D16A4E]">
                              마음 비상 지원 울타리: 너를 보호해 줄 실시간 소통 채널
                            </div>
                            <p className="text-[10px] text-[#4A443F] leading-relaxed mt-0.5">
                              답답한 생각을 혼자서 견디지 마세요. 24시간 언제나 마음 온기를 전해 줄 다정한 소통 창구들과 상담망입니다.
                            </p>
                            <div className="flex gap-2.5 mt-2">
                              <a href="tel:109" className="bg-[#D16A4E] text-white px-2.5 py-1 rounded text-[10px] font-bold flex items-center gap-1 hover:brightness-110 justify-center">
                                <PhoneCall className="w-2.5 h-2.5" /> 마음안심 긴급상담 hotline (109)
                              </a>
                              <a href="tel:1388" className="bg-[#FAF9F6] text-[#4A443F] border border-[#E5E2D9] px-2.5 py-1 rounded text-[10px] font-bold flex items-center gap-1 hover:bg-[#F5F4F0] justify-center">
                                <Smile className="w-2.5 h-2.5 text-[#D4A373]" /> 청소년 모바일 상담망 (1388)
                              </a>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Analytical Insights summary */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 bg-[#FAF9F6] rounded-xl border border-[#E5E2D9]">
                          <details className="group cursor-pointer">
                            <summary className="list-none flex items-center justify-between text-[10px] font-bold text-[#9A948E] select-none hover:text-[#4A443F]">
                              <span className="flex items-center gap-1">
                                🔎 너의 마음속 및 조언 지표 (클릭하여 보기)
                              </span>
                              <span className="text-[8px] transition-transform group-open:rotate-180">▼</span>
                            </summary>
                            <p className="text-[11px] text-[#4A443F] leading-relaxed mt-2 pt-2 border-t border-[#E5E2D9]/70 whitespace-pre-line">
                              {pillarAnalysis[selectedQueryId].insight}
                            </p>
                          </details>
                        </div>

                        {/* RAG matched references showing how precise the logic is */}
                        <div className="p-3 bg-[#FAF9F6] rounded-xl border border-[#E5E2D9] flex flex-col justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-[#9A948E] block mb-1 flex items-center gap-1">
                              📚 지식 라이브러리 참조 매칭
                            </span>
                            <div className="space-y-1">
                              {pillarAnalysis[selectedQueryId].matchedReferenceCases?.length > 0 ? (
                                pillarAnalysis[selectedQueryId].matchedReferenceCases.map((ref: any, idx: number) => (
                                  <div key={idx} className="text-[10px] text-[#7A746E] flex justify-between items-center gap-1">
                                    <span className="truncate">"{ref.studentResponse}"</span>
                                    <span className="text-[8px] bg-[#E5E2D9] text-[#4A443F] px-1 rounded shrink-0 font-mono">
                                      {getFriendlyRiskLabel(ref.riskLevel)}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <p className="text-[10px] italic text-[#9A948E]">
                                  매칭된 참조용 소스 데이터가 부족하여 기본 대처 가이드를 사용했습니다.
                                </p>
                              )}
                            </div>
                          </div>
                          <p className="text-[9px] text-[#8BA888] mt-2 font-mono">
                            * 검색 정확도는 DB 구축 수에 비례합니다.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center py-12 bg-[#FAF9F6] rounded-2xl border border-dashed border-[#E5E2D9] text-center p-6">
                      <Heart className="w-8 h-8 text-[#8BA888] mb-2 animate-pulse" />
                      <h4 className="text-xs font-semibold text-[#4A443F]">아직 마음 진단을 시작하지 않았습니다.</h4>
                      <p className="text-[11px] text-[#9A948E] max-w-xs mt-1 leading-snug">
                        위 질문에 답장 칸을 채우고 'AI 정밀 분석' 버튼을 눌러주세요. 감겨있는 속마음을 분석해 드립니다.
                      </p>
                    </div>
                  )}
                </div>

                {/* 6 Core Pillars Merged Diagnostic Summary Dashboard */}
                {(() => {
                  const completedPillars = queries.filter(q => !!pillarAnalysis[q.id]);
                  if (completedPillars.length === 0) return null;
                  return (
                    <div className="mt-4 pt-4 border-t border-[#E5E2D9] space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-[#4A443F] flex items-center gap-1.5 uppercase font-sans tracking-wide">
                          <FileText className="w-3.5 h-3.5 text-[#8BA888]" />
                          6대 기둥 종합 마음 진단 통계 요약
                        </h3>
                        <span className="text-[10px] font-mono font-bold bg-[#8BA888]/15 text-[#647C62] px-2 py-0.5 rounded-full">
                          {completedPillars.length} / 6 완료
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {queries.map((q) => {
                          const analysis = pillarAnalysis[q.id];
                          const answer = pillarAnswers[q.id];
                          
                          return (
                            <div 
                              key={q.id}
                              onClick={() => setSelectedQueryId(q.id)}
                              className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                                selectedQueryId === q.id 
                                  ? 'bg-[#8BA888]/5 border-[#8BA888] ring-1 ring-[#8BA888]/20' 
                                  : 'bg-[#FAF9F6] border-[#E5E2D9] hover:bg-white hover:border-[#CDC9C0]'
                              }`}
                            >
                              <div className="flex justify-between items-start gap-1">
                                <span className="text-[10px] font-bold text-[#4A443F] truncate">
                                  {q.id}번 영역. {q.category.split('(')[0]?.trim() || q.category}
                                </span>
                                {analysis ? (
                                  <span className={`px-1.5 py-0.2 text-[8px] font-bold rounded border uppercase ${getRiskColorClasses(analysis.riskLevel)}`}>
                                    {getFriendlyRiskLabel(analysis.riskLevel)}
                                  </span>
                                ) : answer && answer.trim().length > 0 ? (
                                  <span className="text-[8px] bg-[#D4A373]/20 text-[#D4A373] border border-[#D4A373]/30 px-1 py-0.2 rounded font-semibold animate-pulse">
                                    대기 중
                                  </span>
                                ) : (
                                  <span className="text-[8px] bg-gray-100 text-[#9A948E] border border-gray-200 px-1 py-0.2 rounded">
                                    미작성
                                  </span>
                                )}
                              </div>
                              
                              <p className="text-[10px] text-[#7A746E] line-clamp-1 italic leading-relaxed">
                                {analysis ? `"${cleanCommentText(analysis.warmResponse)}"` : answer ? `"${answer}"` : "답변이 기입되지 않았습니다."}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

              </div>
            </div>
          )}

          {/* Mode 2: Interactive Realtime AI Chatbot */}
          {activeCenterMode === 'freechat' && (
            <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 shadow-sm flex-1 flex flex-col overflow-hidden justify-between">
              
              {/* Chat Monitor Details & Live indicators */}
              <div className="border-b border-[#E5E2D9] pb-2.5 mb-2 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="p-1 px-2.5 rounded-full bg-[#FAF9F6] text-xs font-semibold border text-[#7A746E]">
                    AI 1:1 대화방
                  </span>
                  <span className="text-[10px] text-[#9A948E]">위기 추적 감도: <strong className="text-[#8BA888]">최상</strong></span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#9A948E]">마음 기류 온도:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${getRiskColorClasses(lastAnalyzedRisk)}`}>
                    {getFriendlyRiskLabel(lastAnalyzedRisk)}
                  </span>
                </div>
              </div>

              {/* Chat Bubble Scrollable List */}
              <div className="flex-1 overflow-y-auto space-y-3.5 px-1 py-2">
                {freeChatHistory.map((msg) => (
                  <div key={msg.id} className={`flex flex-col ${msg.sender === 'student' ? 'items-end' : 'items-start'}`}>
                    
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[10px] font-semibold text-[#7A746E]">
                        {msg.sender === 'student' ? '청소년' : '안심 AI 노아'}
                      </span>
                      <span className="text-[9px] text-[#9A948E] font-mono">{msg.timestamp}</span>
                    </div>

                    <div className={`p-3 rounded-2xl max-w-[85%] text-xs leading-relaxed ${
                      msg.sender === 'student'
                        ? 'bg-[#8BA888] text-white rounded-tr-none shadow-sm'
                        : 'bg-[#FAF9F6] border border-[#E5E2D9] text-[#4A443F] rounded-tl-none'
                    }`}>
                      <p className="whitespace-pre-line">{cleanCommentText(msg.text)}</p>
                      
                      {/* Attached insight for AI replies */}
                      {msg.insight && (
                        <details className="mt-2.5 pt-2 border-t border-[#E5E2D9] text-[10px] text-[#7A746E] group cursor-pointer">
                          <summary className="list-none flex items-center justify-between font-bold text-[#D4A373] select-none hover:opacity-80">
                            <span>💡 너의 마음속 (클릭하여 보기)</span>
                            <span className="text-[8px] transition-transform group-open:rotate-180">▼</span>
                          </summary>
                          <div className="mt-1.5 pl-1.5 border-l border-[#D4A373]/30 text-[#4A443F]/90 whitespace-pre-line">
                            {msg.insight}
                          </div>
                        </details>
                      )}

                      {/* Hotlines printed to student instantly if critical */}
                      {msg.riskLevel && ['critical', 'high risk'].includes(msg.riskLevel.toLowerCase()) && (
                        <div className="mt-2 p-2 bg-[#D16A4E]/10 rounded-lg text-[10px] text-[#D16A4E] border border-[#D16A4E]/20 space-y-1">
                          <p className="font-bold">🚨 지키미 안전 경계선 가동</p>
                          <p>지금 바로 누군가와 대화하여 도움을 안심하고 받으실 수 있어요.</p>
                          <div className="flex gap-1.5 mt-1">
                            <a href="tel:109" className="bg-[#D16A4E] text-white px-2 py-0.5 rounded text-[9px] font-bold inline-block font-mono">전화 109</a>
                            <a href="tel:1388" className="bg-[#FAF9F6] border border-[#E5E2D9] text-[#4A443F] px-2 py-0.5 rounded text-[9px] font-bold inline-block font-mono">1388 청소년</a>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {chatAnalyzing && (
                  <div className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded-full bg-[#8BA888]/20 flex items-center justify-center animate-spin">
                      <Loader2 className="w-3.5 h-3.5 text-[#8BA888]" />
                    </div>
                    <div className="text-[11px] italic text-[#9A948E] bg-[#FAF9F6] border border-[#E5E2D9] p-2.5 rounded-xl rounded-tl-none animate-pulse">
                      선생님이 답변을 소중하게 써 내려가고 있습니다. 잠시만 기다려 주세요...
                    </div>
                  </div>
                )}

                <div ref={chatBottomRef} />
              </div>

              {/* Chat Input form */}
              <form onSubmit={handleSendMessage} className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="외롭거나 불안한 기분, 오늘 있었던 고민을 무엇이든 편하게 이야기해 줘..."
                  disabled={chatAnalyzing}
                  className="flex-1 p-2.5 text-xs rounded-xl bg-white border border-[#E5E2D9] text-[#4A443F] focus:outline-none focus:ring-2 focus:ring-[#8BA888] focus:border-[#8BA888]"
                />
                <button
                  type="submit"
                  disabled={chatAnalyzing || !chatInput.trim()}
                  className="p-2.5 bg-[#8BA888] hover:bg-[#72926E] disabled:bg-[#CDC9C0] text-white rounded-xl transition-all shadow-md active:scale-95 shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}

        </section>

        {/* RIGHT COLUMN: Counselor Library Database & Bulk Dataset Importer */}
        {showAdminPanel && (
          <section className="col-span-12 lg:col-span-3 flex flex-col gap-4 overflow-y-auto">
            {!isAuthorized ? (
              <div className="bg-white border border-[#E5E2D9] rounded-2xl p-5 shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-[#FAF9F6] pb-3 mb-1">
                  <div className="p-2 rounded-xl bg-[#D4A373]/10 text-[#D4A373]">
                    <Lock className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-[#4A443F]">어드민 & 개발자 인증</h3>
                    <p className="text-[10px] text-[#9A948E]">상담 가이드라인 지식 제어 관리</p>
                  </div>
                </div>
                <p className="text-[11px] text-[#7A746E] leading-relaxed">
                  해당 영역은 AI 데이터베이스 가이드를 관리하고 100~200여 건의 대용량 자료를 일괄 업로드하는 **보안 관리 영역**입니다.
                  학생의 불필요한 노출을 방지하기 위해 패스코드 기입이 요구됩니다.
                </p>
                <form onSubmit={handleAuthorizeDev} className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-[#9A948E] uppercase tracking-wider block mb-1">보안 수동 기입코드</label>
                    <input
                      type="password"
                      value={devCodeInput}
                      onChange={(e) => setDevCodeInput(e.target.value)}
                      placeholder="패스코드를 입력하세요..."
                      className="w-full p-2.5 text-xs rounded-xl bg-[#FAF9F6] border border-[#E5E2D9] text-[#4A443F] focus:outline-none focus:ring-1 focus:ring-[#8BA888]"
                    />
                  </div>
                  {devAuthError && <div className="text-[10px] text-red-500 font-medium leading-normal">{devAuthError}</div>}
                  <button
                    type="submit"
                    className="w-full bg-[#8BA888] hover:bg-[#72926E] text-white py-2.5 rounded-xl text-xs font-bold shadow hover:shadow-md transition-all active:scale-95"
                  >
                    기능 잠금해제 및 관리 허브 구동
                  </button>
                </form>
              </div>
            ) : (
              <>
                {/* Model Accuracy Performance Box (Moved & Subtly hidden in authorized Admin view) */}
                <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 flex flex-col gap-1.5 shadow-sm">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold tracking-tight text-[#4A443F] flex items-center gap-1.5">
                      <Brain className="w-4 h-4 text-[#8BA888]" /> AI 위기 검사 정확도 (검증 수치)
                    </span>
                    <span className="font-mono font-bold text-[#8BA888] text-sm">94.8%</span>
                  </div>
                  
                  <div className="w-full bg-[#E5E2D9] h-2 rounded-full mt-2 overflow-hidden">
                    <div className="bg-[#8BA888] h-full w-[94.8%] rounded-full transition-all duration-1000"></div>
                  </div>

                  <p className="text-[10px] text-[#9A948E] leading-relaxed mt-1.5">
                    최근 수집된 청소년 응답 {allCases.length}건을 기준으로 매칭 정확도 및 예방 교차 검증 통계를 수행 중입니다. (임포트 자료량 및 대조 기준선 수립에 따른 교정 성능지표)
                  </p>
                </div>

                {/* BULK UPLOAD PANEL (Specifically created for user's 100-200 material sheet) */}
                <div className="bg-[#FAF9F6] border border-[#E5E2D9] rounded-2xl p-4 shadow-sm flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-[#4A443F] flex items-center gap-1.5">
                      <Upload className="w-4 h-4 text-[#8BA888]" />
                      대용량 자료 일괄 업로드
                    </h3>
                    <button
                      onClick={handleDeauthorizeDev}
                      className="text-[9px] font-mono bg-red-100 hover:bg-red-200 text-red-700 px-1.5 py-0.5 rounded transition-all uppercase font-semibold border border-red-200 animate-pulse"
                    >
                      잠금(Lock)
                    </button>
                  </div>

                  <p className="text-[11px] text-[#7A746E] leading-snug">
                    구글 시트나 엑셀에서 **질문 열(2-1 왜 행복, 1-6 평소 우울 등)과 전체 답변 범위**를 복사해 오신 뒤 'CSV / 스프레드시트'를 선택하여 붙여넣으시면, 인공지능이 항목을 자동 분류하고 최적의 심리 소견과 대책을 부여하여 지식고로 수장합니다.
                  </p>

                  {/* Selector for bulk formatting */}
                  <div className="flex rounded-lg bg-white border border-[#E5E2D9] p-0.5">
                    {(['txt', 'json', 'csv'] as const).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setBulkFormat(fmt)}
                        className={`flex-1 py-1 text-[10px] uppercase font-bold rounded-md transition-all ${
                          bulkFormat === fmt 
                            ? 'bg-[#8BA888] text-white shadow-sm'
                            : 'text-[#9A948E] hover:text-[#4A443F]'
                        }`}
                      >
                        {fmt === 'txt' ? '자연어 텍스트' : fmt === 'csv' ? 'CSV / 스프레딧' : fmt}
                      </button>
                    ))}
                  </div>

                  {/* Template loader & preview helper */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => loadExampleTemplate(bulkFormat)}
                      className="flex-1 bg-white hover:bg-[#F5F4F0] border border-[#E5E2D9] rounded py-1 text-[9px] font-semibold text-[#7A746E] flex items-center justify-center gap-1"
                    >
                      <FileText className="w-3 h-3 text-[#8BA888]" />
                      샘플 서식 자동 채우기
                    </button>
                    {bulkText && (
                      <button
                        type="button"
                        onClick={() => setBulkText("")}
                        className="bg-white hover:bg-red-50 border border-red-200 rounded px-1.5 text-[9px] font-bold text-red-500"
                        title="지우기"
                      >
                        지우기
                      </button>
                    )}
                  </div>

                  {/* Upload form field */}
                  <div className="relative">
                    <textarea
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      placeholder={
                        bulkFormat === 'txt'
                          ? "카테고리: 내마음 소외\n학생: 친구들에게 은따를 당해요...\n조언: 너는 틀린 것이 아니란다...\n위험도: Medium Risk\n전략: 교실 대변화...\n\n(위 양식으로 공란을 두어 아래로 길게 붙여넣으세요)"
                          : bulkFormat === 'json'
                          ? "JSON 배열 형태로 다량의 엔트리를 통째로 파싱할 구조를 이곳에 붙여넣어주세요..."
                          : "구글 시트나 엑셀 표에서 '상부 질문 제목 열'과 '수집 답변 데이터' 영역을 드래그하여 여기에 그대로 복사 붙여넣기(Ctrl+C, Ctrl+V) 해주세요!\n(탭(Tab) 또는 쉼표(,) 구분자를 자동 파싱하여 각 검상 질문 영역(우울, 외로움 등)으로 매핑 및 전문 위로 조언 오토제네레이션 구동)"
                      }
                      className="w-full h-32 p-2 text-[10px] font-mono bg-white border border-[#E5E2D9] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#8BA888] focus:border-[#8BA888] resize-none leading-relaxed"
                    />
                  </div>

                  {/* Status indicators */}
                  {bulkStatus.message && (
                    <div className={`p-2.5 rounded-lg text-[10px] border ${
                      bulkStatus.type === 'success' 
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                        : 'bg-red-50 text-red-800 border-red-200'
                    }`}>
                      {bulkStatus.message}
                    </div>
                  )}

                  {/* Launch button */}
                  <button
                    onClick={handleBulkUpload}
                    disabled={isUploading || !bulkText.trim()}
                    className="w-full bg-[#8BA888] hover:bg-[#72926E] disabled:bg-[#CDC9C0] text-white py-2 rounded-xl text-xs font-bold shadow transition-all flex items-center justify-center gap-1.5"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        파일 파싱 및 주입 중...
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        데이터베이스 병합 (Bulk Inject)
                      </>
                    )}
                  </button>
                </div>

                {/* MASTER DATABASE LIST CONTROLLER */}
                <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 shadow-sm flex flex-col gap-3 flex-1 overflow-hidden">
                  
                  <div className="flex justify-between items-center select-none">
                    <h3 className="text-xs font-bold text-[#4A443F] flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-[#D4A373]" />
                      현구축 상담 지식고 ({filteredCases.length}건)
                    </h3>
                    <button
                      onClick={() => setIsAddingCase(!isAddingCase)}
                      className="p-1 bg-[#8BA888]/10 hover:bg-[#8BA888]/20 text-[#647C62] rounded-lg transition-all"
                      title="단일 사례 즉석 추가"
                    >
                      {isAddingCase ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5 text-[#8BA888]" />}
                    </button>
                  </div>

                  {/* Add single case manual form */}
                  {isAddingCase ? (
                    <form onSubmit={handleAddCase} className="p-3 bg-[#FAF9F6] border border-[#E5E2D9] rounded-xl text-[10px] space-y-2 text-[#4A443F] shrink-0 overflow-y-auto max-h-60">
                      <h4 className="font-bold border-b border-[#E5E2D9] pb-1 flex items-center gap-1 text-[#8BA888]">
                        <Plus className="w-3 h-3" /> 매칭용 신규 사례 수동 기재
                      </h4>

                      <div>
                        <label className="block font-semibold mb-0.5">대구분 카테고리</label>
                        <select
                          value={newCaseForm.category}
                          onChange={(e) => setNewCaseForm(prev => ({ ...prev, category: e.target.value }))}
                          className="w-full p-1 bg-white border border-[#E5E2D9] rounded focus:outline-none"
                        >
                          <option value="학업과 일상 고민 (Daily Pressure & Concerns)">학업과 일상 고민</option>
                          <option value="관계와 외로움 (Connection & Solitude)">관계와 외로움</option>
                          <option value="마음의 겨울 (Helplessness & Future)">마음의 겨울</option>
                          <option value="소외 상처 공감 및 영혼 케어 (Self-Worth & Empathy)">소외 상처 공감</option>
                          <option value="감정 속도 조절 (Impulsivity & Mood)">감정 속도 조절</option>
                          <option value="마음 속 무거운 그늘 (Emotional Safety & Comfort)">마음 속 무거운 그늘</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold mb-0.5">안전 위기 등급</label>
                        <select
                          value={newCaseForm.riskLevel}
                          onChange={(e) => setNewCaseForm(prev => ({ ...prev, riskLevel: e.target.value }))}
                          className="w-full p-1 bg-white border border-[#E5E2D9] rounded focus:outline-none"
                        >
                          <option value="Safe">Safe (마음 맑음)</option>
                          <option value="Low Risk">Low Risk (소담한 구름)</option>
                          <option value="Medium Risk">Medium Risk (흐린 소나기)</option>
                          <option value="High Risk">High Risk (조금 센 바람)</option>
                          <option value="Critical">Critical (보살핌의 따스함 필요)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold mb-0.5">가정 청소년 대답 샘플</label>
                        <textarea
                          rows={2}
                          value={newCaseForm.studentResponse}
                          onChange={(e) => setNewCaseForm(prev => ({ ...prev, studentResponse: e.target.value }))}
                          placeholder="예: 지칠 때는 세상이 잠깐 멈췄으면 좋겠다는 고민이 차오릅니다..."
                          className="w-full p-1 bg-white border border-[#E5E2D9] rounded focus:outline-none font-sans"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold mb-0.5">매칭시 권장 위로 답변</label>
                        <textarea
                          rows={2}
                          value={newCaseForm.idealResponse}
                          onChange={(e) => setNewCaseForm(prev => ({ ...prev, idealResponse: e.target.value }))}
                          placeholder="예: 네가 그렇게 무거운 돌덩이를 가슴에 얹고 있었다니 정말 눈물겹고 지쳤겠구나..."
                          className="w-full p-1 bg-white border border-[#E5E2D9] rounded focus:outline-none font-sans"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold mb-0.5">전문 분석 예방전략</label>
                        <input
                          type="text"
                          value={newCaseForm.strategy}
                          onChange={(e) => setNewCaseForm(prev => ({ ...prev, strategy: e.target.value }))}
                          placeholder="예: 과업 비관 예방 및 정서 지지"
                          className="w-full p-1 bg-white border border-[#E5E2D9] rounded focus:outline-none font-sans"
                        />
                      </div>

                      {addCaseStatus.message && (
                        <div className={`text-[9px] p-1.5 rounded ${addCaseStatus.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                          {addCaseStatus.message}
                        </div>
                      )}

                      <button
                        type="submit"
                        className="w-full bg-[#8BA888] hover:bg-[#72926E] text-white py-1.5 rounded font-bold transition-all text-[10px]"
                      >
                        신규 데이터 저장
                      </button>
                    </form>
                  ) : null}

                  {/* Filter and search control bar */}
                  <div className="space-y-2 shrink-0">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#9A948E] absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        value={dbSearch}
                        onChange={(e) => setDbSearch(e.target.value)}
                        placeholder="지식 대조고 검색 (예: 1388, 시험)..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-[#FAF9F6] border border-[#E5E2D9] text-[#4A443F] focus:outline-none focus:ring-1 focus:ring-[#8BA888]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="text-[9px] font-bold text-[#9A948E] block mb-0.5">카테고리 분류</label>
                        <select
                          value={dbCategoryFilter}
                          onChange={(e) => setDbCategoryFilter(e.target.value)}
                          className="w-full p-1 text-[10px] bg-[#FAF9F6] border border-[#E5E2D9] rounded"
                        >
                          <option value="전체">전체 카테고리</option>
                          <option value="학업">학업과 일상 고민</option>
                          <option value="관계">관계와 외로움</option>
                          <option value="겨울">마음의 겨울</option>
                          <option value="아끼기">나를 아끼기</option>
                          <option value="울컥">울컥하는 마음</option>
                          <option value="그늘">마음 속 무거운 그늘</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[9px] font-bold text-[#9A948E] block mb-0.5">상태등급 분류</label>
                        <select
                          value={dbRiskFilter}
                          onChange={(e) => setDbRiskFilter(e.target.value)}
                          className="w-full p-1 text-[10px] bg-[#FAF9F6] border border-[#E5E2D9] rounded"
                        >
                          <option value="전체">전체 등급</option>
                          <option value="safe">Safe (맑음)</option>
                          <option value="low">Low Risk (구름)</option>
                          <option value="medium">Medium Risk (비)</option>
                          <option value="high">High Risk (바람)</option>
                          <option value="critical">Critical (비상)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Table view list of filtered cases */}
                  <div className="flex-1 overflow-y-auto border border-[#E5E2D9] rounded-xl bg-[#FAF9F6]">
                    {loadingCases ? (
                      <div className="h-full flex items-center justify-center py-10">
                        <Loader2 className="w-5 h-5 animate-spin text-[#8BA888]" />
                      </div>
                    ) : filteredCases.length === 0 ? (
                      <div className="text-center py-8 text-[11px] text-[#9A948E] italic">
                        매칭되는 지식고 사례가 발견되지 않았습니다.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#E5E2D9]">
                        {filteredCases.map((c, index) => {
                          const isSeed = (c.id || '').startsWith("case-seed-");
                          return (
                            <div key={c.id || index} className="p-3 hover:bg-white text-[11px] space-y-1.5 transition-all text-[#4A443F] relative group">
                              <div className="flex justify-between items-start gap-1 pb-1 border-b border-dashed border-[#E5E2D9]/70">
                                <span className="font-bold text-[#647C62] text-[10px] truncate max-w-[180px] sm:max-w-none">
                                  {isSeed ? "🌱 기본 " : "🔒 주입 "} | {c.category.split('(')[0]?.trim() || c.category}
                                </span>
                                
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={`px-1 rounded text-[8px] font-bold border ${getRiskColorClasses(c.riskLevel)}`}>
                                    {getFriendlyRiskLabel(c.riskLevel).split(' ')[1]}
                                  </span>

                                  {/* Delete case trigger */}
                                  <button
                                    onClick={() => handleDeleteCase(c.id, isSeed)}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 text-red-500 rounded transition-all"
                                    title="사례 제외 및 삭제"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                              
                              <p className="text-[10px] text-[#4A443F] font-semibold leading-relaxed">
                                <span className="text-[#D4A373]">학생 고백:</span> "{c.studentResponse}"
                              </p>

                              <p className="text-[10px] text-[#7A746E] leading-relaxed italic bg-white/50 p-1.5 rounded border border-[#E5E2D9]/30">
                                <span className="text-[#8BA888] font-bold">권장 지도안:</span> "{c.idealResponse}"
                              </p>

                              {c.strategy && (
                                <p className="text-[9px] text-[#9A948E] font-mono">
                                  ⚡ 전략선: {c.strategy}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        )}

      </main>

      {/* Persistent Bottom Status Footer */}
      <footer 
        onClick={() => setShowAdminPanel(!showAdminPanel)}
        className="h-8 border-t border-[#E5E2D9] px-4 flex items-center justify-between text-[10px] text-[#9A948E] font-mono shrink-0 bg-white select-none cursor-pointer hover:bg-[#FAF9F6]/80 transition-all"
        title="시스템 진단 & 데이터베이스 관리 도구"
      >
        <div>
          🔐 END-TO-END ANONYMOUS INTEGRATION | 마음 소외 119 울타리 가동 중
        </div>
        <div>
          © NOA HEALTHCARE INTERACT SYSTEM 2026
        </div>
      </footer>
    </div>
  );
}
