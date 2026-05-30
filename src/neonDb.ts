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
    "category": "공부와 미래 고민",
    "question": "성적이나 앞으로의 진로 생각 때문에 머리 아프고 어깨가 무거운 상태인가요?",
    "description": "공부 부담과 학교 생활로 지치고 마음 졸이는 고민"
  },
  {
    "id": 2,
    "category": "인간관계 스트레스",
    "question": "친구 무리와 멀어지거나 학교에서 대화할 때 소외감을 자주 느끼시나요?",
    "description": "친구 소통, 소극적인 성향 관리 및 마찰"
  },
  {
    "id": 3,
    "category": "우울하고 지친 마음",
    "question": "가슴 구석이 은근히 아리고 가끔 쓸쓸한 우울감이 쏟아지며 마음이 가라앉나요?",
    "description": "슬픔, 일상 속 작은 위안이 필요한 불안정한 마음"
  },
  {
    "id": 4,
    "category": "수면 및 휴식 욕구",
    "question": "무기력을 부쩍 느끼며 온몸을 가만히 침대에 눕히고 푹 쉬고만 싶을 때가 잦나요?",
    "description": "피로감에 모든 스위치를 잠시 끄고 흘려보내고 싶은 쉼"
  },
  {
    "id": 5,
    "category": "자기이해 및 자아상",
    "question": "무언가 잘 안 풀리거나 힘들 때 전부 내 잘못인 것만 같아 내 탓을 하게 되나요?",
    "description": "자존감 성찰, 속상함과 긍정적인 나 가꾸기"
  },
  {
    "id": 6,
    "category": "가족 갈등",
    "question": "가장 편히 기대어야 할 가족이나 부모님 잔소리 혹은 싸움 때문에 진짜 답답하신가요?",
    "description": "가정 내 대립, 부모님과의 서러운 마찰과 소통 부담"
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
