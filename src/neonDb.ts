import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { DEFAULT_CASES, ReferenceCase } from "./defaultCases";

const DB_PATH = path.join(process.cwd(), "data", "db.json");

// Check if Neon DB is configured via env
export function isNeonConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

// Lazy SQL Client initializer to prevent crashing on missing credentials at startup
let sqlClient: any = null;
function getSqlClient() {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

// Global initialization flag
let isInitialized = false;

// Simplified Korean standard inquiries
const DEFAULT_QUERIES = [
  {
    "id": 1,
    "category": "학업과 일상 고민 (Daily Pressure & Concerns)",
    "question": "요즘 나의 일상과 학업, 인간관계에서 마음을 무겁게 만드는 고민의 크기와 이를 나만의 지혜로운 쉼으로 덜어내는 방법은 어떠한가요?",
    "description": "학업 성적, 친구 관계 등으로 인한 압박감과 주관적인 극복 및 치유 힘을 파악합니다."
  },
  {
    "id": 2,
    "category": "관계와 외로움 (Connection & Solitude)",
    "question": "주변 사람들(가족, 친구, 선생님 등)과의 따뜻한 흐름을 얼마나 느끼고 있으며, 속상할 때 내 편에 서서 이야기를 들어줄 대상이 있나요?",
    "description": "다정하게 귀 기울여줄 울타리가 곁에 있는지 확인하여 마음의 정서적 완충 지대를 살핍니다."
  },
  {
    "id": 3,
    "category": "마음의 겨울 (Helplessness & Future)",
    "question": "미래나 다가올 내일을 꿈꿀 때, 어떤 느낌(희망, 차분함, 혹은 기운 빠짐 등)이 가슴에 먼저 잔물결처럼 찾아오나요?",
    "description": "하루의 끝자락에서 느끼는 일시적 피로와 장기적 위안을 포용하여 안전도를 헤아립니다."
  },
  {
    "id": 4,
    "category": "나를 아끼기 (Self-Worth & Acceptance)",
    "question": "내 존재와 살아가고 있는 가치에 대해 평소에 얼마나 소중하게 토닥이고 안아주고 있나요?",
    "description": "나를 낮게 미워하거나 짐이 된다는 자책을 다독이며 존귀함을 강화하는 인자가 파악합니다."
  },
  {
    "id": 5,
    "category": "울컥하는 마음 (Impulsivity & Control)",
    "question": "지치고 피곤할 때, 혹은 마음이 한순간 복받쳐 올라올 때 감정의 속도를 조절하기 힘든 적이 얼마나 자주 있나요?",
    "description": "울컥 튀어나오는 감정 지수를 유연하게 완화하고, 안전하게 흘려보내는 환기책을 찾습니다."
  },
  {
    "id": 6,
    "category": "마음 속 무거운 그늘 (Emotional Safety & Comfort)",
    "question": "최근 너무 지치고 지쳐서 세상의 스위치를 조용히 끄고 싶다거나, 차라리 깊게 잠들어 마음의 짐을 다 놓아버리고 싶은 충동이 밀려온 적이 있나요?",
    "description": "가장 지치고 아픈 마음을 감지하여 안전망(마음 헬프라인 1388)과 연계하고 안식을 구축합니다."
  }
];

// Initialize database (creates tables & seeds default values in Neon OR initializes db.json local fallback)
export async function initDatabase(): Promise<boolean> {
  const sql = getSqlClient();
  if (sql) {
    console.info("[DB SERVICE] Initializing Neon PostgreSQL Database connection...");
    try {
      // 1. Create queries table
      await sql`
        CREATE TABLE IF NOT EXISTS queries (
          id INT PRIMARY KEY,
          category TEXT NOT NULL,
          question TEXT NOT NULL,
          description TEXT
        )
      `;

      // 2. Create cases table
      await sql`
        CREATE TABLE IF NOT EXISTS cases (
          id VARCHAR(255) PRIMARY KEY,
          query_id INTEGER,
          category TEXT NOT NULL,
          student_response TEXT NOT NULL,
          ideal_response TEXT NOT NULL,
          risk_level VARCHAR(50) NOT NULL,
          strategy TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // 3. Seed queries if empty
      const existingQueries = await sql`SELECT count(*) as count FROM queries`;
      const qCount = parseInt(existingQueries[0]?.count ?? "0", 10);
      if (qCount === 0) {
        console.info("[DB SERVICE] Seeding Neon PostgreSQL 'queries' table with baseline inquiries...");
        for (const q of DEFAULT_QUERIES) {
          await sql`
            INSERT INTO queries (id, category, question, description)
            VALUES (${q.id}, ${q.category}, ${q.question}, ${q.description})
            ON CONFLICT (id) DO NOTHING
          `;
        }
      }

      // 4. Seed cases if empty
      const existingCases = await sql`SELECT count(*) as count FROM cases`;
      const cCount = parseInt(existingCases[0]?.count ?? "0", 10);
      if (cCount === 0) {
        console.info("[DB SERVICE] Seeding Neon PostgreSQL 'cases' table with master references...");
        for (const c of DEFAULT_CASES) {
          await sql`
            INSERT INTO cases (id, query_id, category, student_response, ideal_response, risk_level, strategy)
            VALUES (${c.id}, ${c.queryId}, ${c.category}, ${c.studentResponse}, ${c.idealResponse}, ${c.riskLevel}, ${c.strategy})
            ON CONFLICT (id) DO NOTHING
          `;
        }
      }

      console.info("[DB SERVICE] Neon PostgreSQL initialized and seeded successfully.");
      isInitialized = true;
      return true;
    } catch (err) {
      console.error("[DB SERVICE] Neon DB initialization crashed, falling back to local JSON file:", err);
    }
  }

  // Local JSON fallback logic:
  if (isInitialized) return true;

  try {
    const parentDir = path.dirname(DB_PATH);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH)) {
      console.info("[DB SERVICE] Initializing local JSON database file...");
      const initialData = {
        queries: DEFAULT_QUERIES,
        cases: DEFAULT_CASES
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2), "utf8");
      console.info("[DB SERVICE] Local JSON database file created successfully with seed data.");
    }

    isInitialized = true;
    return true;
  } catch (err) {
    console.error("[DB SERVICE] Error initializing local file database:", err);
    return false;
  }
}

// Read database fallback helper
function readLocalDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return {
        queries: DEFAULT_QUERIES,
        cases: DEFAULT_CASES
      };
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(data);
    
    const fileQueries = parsed.queries || DEFAULT_QUERIES;
    const fileCases = parsed.cases || DEFAULT_CASES;

    // Remove duplicates recursively by id
    const casesMap = new Map<string, ReferenceCase>();
    DEFAULT_CASES.forEach((c) => casesMap.set(c.id, c));
    fileCases.forEach((c: any) => casesMap.set(c.id, c));

    const mergedCases = Array.from(casesMap.values());
    const customCases = mergedCases.filter((c: any) => !c.id.startsWith("case-seed-"));
    const seedCases = mergedCases.filter((c: any) => c.id.startsWith("case-seed-"));
    
    return {
      queries: fileQueries,
      cases: [...customCases, ...seedCases]
    };
  } catch (err) {
    console.error("[DB SERVICE] Error reading local JSON database, returning runtime cache defaults:", err);
    return {
      queries: DEFAULT_QUERIES,
      cases: DEFAULT_CASES
    };
  }
}

// Write database fallback helper
function writeLocalDB(data: { queries: any[]; cases: ReferenceCase[] }): boolean {
  try {
    const parentDir = path.dirname(DB_PATH);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("[DB SERVICE] Error writing to local JSON database:", err);
    return false;
  }
}

// 1. Get Queries (Async to match Neon)
export async function getQueries(): Promise<any[]> {
  await initDatabase();
  const sql = getSqlClient();
  if (sql) {
    try {
      const rows = await sql`
        SELECT id, category, question, description
        FROM queries
        ORDER BY id ASC
      `;
      if (rows && rows.length > 0) {
        return rows;
      }
    } catch (err) {
      console.warn("[DB SERVICE] Neon Queries read failed, falling back to local file...", err);
    }
  }

  const local = readLocalDB();
  return local.queries;
}

// 2. Fetch Cases
export async function getCases(): Promise<ReferenceCase[]> {
  await initDatabase();
  const sql = getSqlClient();
  if (sql) {
    try {
      const rows = await sql`
        SELECT 
          id, 
          query_id as "queryId", 
          category, 
          student_response as "studentResponse", 
          ideal_response as "idealResponse", 
          risk_level as "riskLevel", 
          strategy
        FROM cases
        ORDER BY created_at DESC, id DESC
      `;
      return rows as ReferenceCase[];
    } catch (err) {
      console.warn("[DB SERVICE] Neon Cases read failed, falling back to local file...", err);
    }
  }

  const local = readLocalDB();
  return local.cases;
}

// 3. Insert a single Case
export async function addCase(newCase: ReferenceCase): Promise<boolean> {
  await initDatabase();
  const sql = getSqlClient();
  if (sql) {
    try {
      await sql`
        INSERT INTO cases (id, query_id, category, student_response, ideal_response, risk_level, strategy)
        VALUES (${newCase.id}, ${newCase.queryId}, ${newCase.category}, ${newCase.studentResponse}, ${newCase.idealResponse}, ${newCase.riskLevel}, ${newCase.strategy})
      `;
      console.info(`[DB SERVICE] Added 1 custom case to Neon: ${newCase.id}`);
      return true;
    } catch (err) {
      console.error("[DB SERVICE] Neon insert failed, writing to local file fallback...", err);
    }
  }

  const local = readLocalDB();
  local.cases.unshift(newCase);
  return writeLocalDB(local);
}

// 4. Delete a Case
export async function deleteCase(id: string): Promise<boolean> {
  await initDatabase();
  const sql = getSqlClient();
  if (sql) {
    try {
      const result = await sql`
        DELETE FROM cases WHERE id = ${id} RETURNING id
      `;
      console.info(`[DB SERVICE] Deleted custom case from Neon: ${id}`);
      return result.length > 0;
    } catch (err) {
      console.error("[DB SERVICE] Neon delete failed, removing from local file fallback...", err);
    }
  }

  const local = readLocalDB();
  const initialLength = local.cases.length;
  local.cases = local.cases.filter((c) => c.id !== id);
  if (local.cases.length === initialLength) {
    return false;
  }
  return writeLocalDB(local);
}

// 5. Bulk insert Cases
export async function addCasesBulk(newCases: ReferenceCase[]): Promise<number> {
  await initDatabase();
  const sql = getSqlClient();
  if (sql) {
    try {
      let insertedCount = 0;
      for (const c of newCases) {
        const result = await sql`
          INSERT INTO cases (id, query_id, category, student_response, ideal_response, risk_level, strategy)
          VALUES (${c.id}, ${c.queryId}, ${c.category}, ${c.studentResponse}, ${c.idealResponse}, ${c.riskLevel}, ${c.strategy})
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        if (result.length > 0) {
          insertedCount++;
        }
      }
      console.info(`[DB SERVICE] Neon bulk insert added ${insertedCount} unique cases.`);
      return insertedCount;
    } catch (err) {
      console.error("[DB SERVICE] Neon bulk insert failed, falling back to local file...", err);
    }
  }

  const local = readLocalDB();
  const existingIds = new Set(local.cases.map(c => c.id));
  const uniqueNewCases = newCases.filter(c => !existingIds.has(c.id));
  
  local.cases = [...uniqueNewCases, ...local.cases];
  const success = writeLocalDB(local);
  return success ? uniqueNewCases.length : 0;
}
