interface HandlerStatsRecord {
  time: number;
  error?: boolean;
  numResponses?: number;
}

interface HandlerStatsData {
  totalTime: number;
  errors: number;
  invocations: number;
  totalResponseCount: number;
}

export interface HandlerStatsReport {
  invocations: number;
  avgTime: number;
  errors: number;
  errorRate: number;
  avgResponseCount: number;
}

export interface Stats {
  origin: string;
  domain: string | null;
  service: Record<string, HandlerStatsReport>;
  client: Record<string, HandlerStatsReport>;
}

class ServiceStats {
  private statsData: Record<string, HandlerStatsData> = {};
  private filter: (domain: string, method: string) => boolean;

  constructor(config?: { filter?: (domain: string, method: string) => boolean }) {
    this.filter = config?.filter || (() => true);
  }

  record(domain: string, method: string, { time, error = false, numResponses = 1 }: HandlerStatsRecord): void {
    if (!this.filter(domain, method)) {
      return;
    }

    const statsKey = `${domain}.${method}`;

    if (!this.statsData[statsKey]) {
      this.statsData[statsKey] = { totalTime: 0, errors: 0, invocations: 0, totalResponseCount: 0 };
    }

    const s = this.statsData[statsKey];
    s.totalTime += time;
    s.errors += error ? 1 : 0;
    s.invocations++;
    s.totalResponseCount += numResponses;
  }

  get stats(): Record<string, HandlerStatsReport> {
    const stats: Record<string, HandlerStatsReport> = {};
    for (const statsKey in this.statsData) {
      const s = this.statsData[statsKey];
      stats[statsKey] = {
        invocations: s.invocations,
        avgTime: s.totalTime / s.invocations,
        errors: s.errors,
        errorRate: s.errors / s.invocations,
        avgResponseCount: s.totalResponseCount / s.invocations,
      };
    }
    return stats;
  }
}

export default ServiceStats;
