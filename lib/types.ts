import type { Role, ClientStatus, MilestoneStatus, ProjectStatus } from "@/lib/constants";

/** A user as returned by /api/team — dates arrive as ISO strings over JSON. */
export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  jobTitle: string;
  avatarColor: string;
  isActive: boolean;
  createdAt: string;
  /** This month's derived score, 0–100. */
  score: number;
  /** Change against last month, or null with no prior cycle. */
  trend: number | null;
  /** Null when nothing has come due yet — "not rated", not "0%". */
  onTimeRate: number | null;
  /** Milestones due this month, and their total weight. Shown beside every
   *  score, because a score without its volume is not comparable. */
  load: number;
  totalWeight: number;
};

export type ServiceSummary = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
};

export type ProjectProgress = {
  total: number;
  done: number;
  percent: number;
};

/** A client card in the grid. */
export type ClientSummary = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  country: string | null;
  industry: string | null;
  monthlyBudget: number;
  status: ClientStatus;
  onboardedAt: string;
  services: ServiceSummary[];
  currentProject: {
    id: string;
    title: string;
    status: ProjectStatus;
    startDate: string;
    endDate: string;
    progress: ProjectProgress;
  } | null;
};

export type AssigneeChip = {
  id: string;
  name: string;
  avatarColor: string;
};

/** A milestone row on the project planner. */
export type MilestoneRow = {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  dueDate: string;
  status: MilestoneStatus;
  submittedAt: string | null;
  completedAt: string | null;
  /** Rough effort in hours; feeds the capacity bars. */
  estimatedHours: number;
  /** True when the renewal job rolled this forward from a closed cycle. */
  carriedOver: boolean;
  order: number;
  assignee: AssigneeChip | null;
  /** Points already charged or credited against this milestone. */
  scoreImpact: number;
};

export type ModuleSection = {
  id: string;
  name: string;
  order: number;
  serviceName: string | null;
  milestones: MilestoneRow[];
};

/** A milestone as it appears on a member's own task list. */
export type MyTask = {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  dueDate: string;
  status: MilestoneStatus;
  submittedAt: string | null;
  completedAt: string | null;
  moduleName: string;
  projectId: string;
  projectTitle: string;
  clientName: string;
};
