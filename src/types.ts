export interface EvaluationQuery {
  id: number;
  category: string;
  question: string;
  description: string;
}

export interface CounselingCase {
  id: string;
  queryId?: number | null;
  category: string;
  studentResponse: string;
  idealResponse: string;
  riskLevel: string;
  strategy?: string;
  score?: number;
}

export interface Message {
  id: string;
  sender: 'student' | 'ai' | 'system';
  text: string;
  riskLevel?: 'Safe' | 'Low Risk' | 'Medium Risk' | 'High Risk' | 'Critical';
  insight?: string;
  timestamp: string;
  referenceCases?: {
    category: string;
    studentResponse: string;
    idealResponse: string;
    riskLevel: string;
  }[];
}

export interface AssessmentAnswer {
  queryId: number;
  text: string;
  analyzing: boolean;
  result?: {
    riskLevel: 'Safe' | 'Low Risk' | 'Medium Risk' | 'High Risk' | 'Critical';
    insight: string;
    warmResponse: string;
    triggerAlert: boolean;
    referencedDbCases?: any[];
  };
}

export interface DiagnosticSummary {
  riskScore: number; // 0 to 100
  overallRisk: 'Safe' | 'Low Risk' | 'Medium Risk' | 'High Risk' | 'Critical';
  summaryInsight: string;
  generalStrategy: string;
}
