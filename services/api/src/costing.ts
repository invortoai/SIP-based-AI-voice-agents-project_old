import { Client } from "pg";
import Redis from "ioredis";

export interface CostingRates {
  asrPerMinute: number;
  ttsPerChar: number;
  llmPerToken: number;
  transportPerMinute: number;
  platformPerCall: number;
}

export interface UsageMetrics {
  asrMinutes: number;
  ttsCharacters: number;
  llmTokens: number;
  callDurationMinutes: number;
  toolCalls: number;
}

export interface CostBreakdown {
  asr: number;
  tts: number;
  llm: number;
  transport: number;
  platform: number;
  tools: number;
  total: number;
}

export class CostingService {
  private pg: Client;
  private redis: Redis;
  private rates: CostingRates;

  constructor(pg: Client, redis: Redis) {
    this.pg = pg;
    this.redis = redis;
    
    // Default rates in INR
    this.rates = {
      asrPerMinute: parseFloat(process.env.RATE_ASR_PER_MIN || "2.5"),
      ttsPerChar: parseFloat(process.env.RATE_TTS_PER_CHAR || "0.001"),
      llmPerToken: parseFloat(process.env.RATE_LLM_PER_TOKEN || "0.0001"),
      transportPerMinute: parseFloat(process.env.RATE_TRANSPORT_PER_MIN || "1.0"),
      platformPerCall: parseFloat(process.env.RATE_PLATFORM_PER_CALL || "0.5"),
    };
  }

  async calculateCallCost(callId: string, usage: UsageMetrics): Promise<CostBreakdown> {
    const breakdown: CostBreakdown = {
      asr: usage.asrMinutes * this.rates.asrPerMinute,
      tts: usage.ttsCharacters * this.rates.ttsPerChar,
      llm: usage.llmTokens * this.rates.llmPerToken,
      transport: usage.callDurationMinutes * this.rates.transportPerMinute,
      platform: this.rates.platformPerCall,
      tools: usage.toolCalls * 0.1, // 10 paise per tool call
      total: 0,
    };

    breakdown.total = Object.values(breakdown).reduce((sum, cost) => sum + cost, 0);

    // Store cost breakdown in database
    await this.storeCostBreakdown(callId, breakdown);

    return breakdown;
  }

  private async storeCostBreakdown(callId: string, breakdown: CostBreakdown): Promise<void> {
    const queries = [
      {
        type: "asr",
        provider: "deepgram",
        cost: breakdown.asr,
      },
      {
        type: "tts",
        provider: "deepgram",
        cost: breakdown.tts,
      },
      {
        type: "llm",
        provider: "openai",
        cost: breakdown.llm,
      },
      {
        type: "transport",
        provider: "twilio",
        cost: breakdown.transport,
      },
      {
        type: "platform",
        provider: "invorto",
        cost: breakdown.platform,
      },
    ];

    for (const query of queries) {
      if (query.cost > 0) {
        await this.pg.query(
          "INSERT INTO call_costs (call_id, type, provider, cost_inr) VALUES ($1, $2, $3, $4)",
          [callId, query.type, query.provider, query.cost]
        );
      }
    }

    // Update total cost in calls table
    await this.pg.query(
      "UPDATE calls SET cost_inr = $1 WHERE id = $2",
      [breakdown.total, callId]
    );
  }

  async getTenantUsage(tenantId: string, period: "day" | "week" | "month" = "day"): Promise<{
    totalCost: number;
    callCount: number;
    totalMinutes: number;
    averageCostPerCall: number;
    averageDuration: number;
  }> {
    const interval = period === "day" ? "1 day" : period === "week" ? "7 days" : "30 days";
    
    const result = await this.pg.query(
      `SELECT 
        COUNT(*) as call_count,
        SUM(cost_inr) as total_cost,
        SUM(duration_sec) / 60.0 as total_minutes,
        AVG(cost_inr) as avg_cost,
        AVG(duration_sec) as avg_duration
      FROM calls 
      WHERE tenant_id = $1 
        AND started_at > NOW() - INTERVAL '${interval}'`,
      [tenantId]
    );

    const row = result.rows[0];
    return {
      totalCost: parseFloat(row.total_cost || "0"),
      callCount: parseInt(row.call_count || "0"),
      totalMinutes: parseFloat(row.total_minutes || "0"),
      averageCostPerCall: parseFloat(row.avg_cost || "0"),
      averageDuration: parseFloat(row.avg_duration || "0"),
    };
  }

  async checkTenantLimits(tenantId: string): Promise<{
    allowed: boolean;
    reason?: string;
    limits: {
      dailyCostCap: number;
      currentDailyCost: number;
      concurrentCalls: number;
      currentConcurrent: number;
      monthlyMinutes: number;
      currentMonthlyMinutes: number;
    };
  }> {
    // Get tenant-specific limits or use defaults
    const dailyCostCap = parseFloat(process.env.DAILY_COST_CAP_INR || "10000");
    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_CALLS || "10");
    const monthlyMinuteCap = parseInt(process.env.MONTHLY_MINUTE_CAP || "10000");

    // Check daily cost
    const dailyCostResult = await this.pg.query(
      "SELECT SUM(cost_inr) as total FROM calls WHERE tenant_id = $1 AND started_at > NOW() - INTERVAL '24 hours'",
      [tenantId]
    );
    const currentDailyCost = parseFloat(dailyCostResult.rows[0]?.total || "0");

    // Check concurrent calls
    const concurrentResult = await this.pg.query(
      "SELECT COUNT(*) as count FROM calls WHERE tenant_id = $1 AND status IN ('created', 'active')",
      [tenantId]
    );
    const currentConcurrent = parseInt(concurrentResult.rows[0]?.count || "0");

    // Check monthly minutes
    const monthlyMinutesResult = await this.pg.query(
      "SELECT SUM(duration_sec) / 60.0 as minutes FROM calls WHERE tenant_id = $1 AND started_at > NOW() - INTERVAL '30 days'",
      [tenantId]
    );
    const currentMonthlyMinutes = parseFloat(monthlyMinutesResult.rows[0]?.minutes || "0");

    const limits = {
      dailyCostCap,
      currentDailyCost,
      concurrentCalls: maxConcurrent,
      currentConcurrent,
      monthlyMinutes: monthlyMinuteCap,
      currentMonthlyMinutes,
    };

    // Check if any limit is exceeded
    if (currentDailyCost >= dailyCostCap) {
      return {
        allowed: false,
        reason: "Daily cost cap exceeded",
        limits,
      };
    }

    if (currentConcurrent >= maxConcurrent) {
      return {
        allowed: false,
        reason: "Maximum concurrent calls reached",
        limits,
      };
    }

    if (currentMonthlyMinutes >= monthlyMinuteCap) {
      return {
        allowed: false,
        reason: "Monthly minute cap exceeded",
        limits,
      };
    }

    return {
      allowed: true,
      limits,
    };
  }

  async updateRates(newRates: Partial<CostingRates>): Promise<void> {
    this.rates = { ...this.rates, ...newRates };
    
    // Store in Redis for persistence
    await this.redis.hset("costing:rates", {
      asrPerMinute: this.rates.asrPerMinute.toString(),
      ttsPerChar: this.rates.ttsPerChar.toString(),
      llmPerToken: this.rates.llmPerToken.toString(),
      transportPerMinute: this.rates.transportPerMinute.toString(),
      platformPerCall: this.rates.platformPerCall.toString(),
    });
  }

  async loadRates(): Promise<void> {
    const rates = await this.redis.hgetall("costing:rates");
    if (rates && Object.keys(rates).length > 0) {
      this.rates = {
        asrPerMinute: parseFloat(rates.asrPerMinute || this.rates.asrPerMinute.toString()),
        ttsPerChar: parseFloat(rates.ttsPerChar || this.rates.ttsPerChar.toString()),
        llmPerToken: parseFloat(rates.llmPerToken || this.rates.llmPerToken.toString()),
        transportPerMinute: parseFloat(rates.transportPerMinute || this.rates.transportPerMinute.toString()),
        platformPerCall: parseFloat(rates.platformPerCall || this.rates.platformPerCall.toString()),
      };
    }
  }

  getRates(): CostingRates {
    return { ...this.rates };
  }

  // Alert system for cost anomalies
  async checkCostAnomalies(callId: string, cost: number): Promise<boolean> {
    // Get average cost for similar calls
    const avgResult = await this.pg.query(
      `SELECT AVG(cost_inr) as avg_cost, STDDEV(cost_inr) as std_dev
       FROM calls 
       WHERE ended_at > NOW() - INTERVAL '7 days'
         AND cost_inr > 0`
    );

    const avgCost = parseFloat(avgResult.rows[0]?.avg_cost || "0");
    const stdDev = parseFloat(avgResult.rows[0]?.std_dev || "0");

    // Check if cost is more than 3 standard deviations from mean
    if (cost > avgCost + (3 * stdDev)) {
      // Log anomaly
      await this.redis.lpush("costing:anomalies", JSON.stringify({
        callId,
        cost,
        avgCost,
        stdDev,
        timestamp: new Date().toISOString(),
      }));

      return true;
    }

    return false;
  }

  // Billing aggregation for invoicing
  async generateInvoiceData(tenantId: string, startDate: Date, endDate: Date): Promise<{
    tenantId: string;
    period: { start: string; end: string };
    summary: {
      totalCalls: number;
      totalMinutes: number;
      totalCost: number;
    };
    breakdown: {
      asr: number;
      tts: number;
      llm: number;
      transport: number;
      platform: number;
      tools: number;
    };
    dailyUsage: Array<{
      date: string;
      calls: number;
      minutes: number;
      cost: number;
    }>;
  }> {
    // Get summary
    const summaryResult = await this.pg.query(
      `SELECT 
        COUNT(*) as total_calls,
        SUM(duration_sec) / 60.0 as total_minutes,
        SUM(cost_inr) as total_cost
      FROM calls
      WHERE tenant_id = $1
        AND started_at >= $2
        AND started_at < $3`,
      [tenantId, startDate, endDate]
    );

    // Get cost breakdown
    const breakdownResult = await this.pg.query(
      `SELECT 
        type,
        SUM(cost_inr) as total
      FROM call_costs cc
      JOIN calls c ON cc.call_id = c.id
      WHERE c.tenant_id = $1
        AND c.started_at >= $2
        AND c.started_at < $3
      GROUP BY type`,
      [tenantId, startDate, endDate]
    );

    const breakdown: any = {
      asr: 0,
      tts: 0,
      llm: 0,
      transport: 0,
      platform: 0,
      tools: 0,
    };

    for (const row of breakdownResult.rows) {
      breakdown[row.type] = parseFloat(row.total);
    }

    // Get daily usage
    const dailyResult = await this.pg.query(
      `SELECT 
        DATE(started_at) as date,
        COUNT(*) as calls,
        SUM(duration_sec) / 60.0 as minutes,
        SUM(cost_inr) as cost
      FROM calls
      WHERE tenant_id = $1
        AND started_at >= $2
        AND started_at < $3
      GROUP BY DATE(started_at)
      ORDER BY date`,
      [tenantId, startDate, endDate]
    );

    return {
      tenantId,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary: {
        totalCalls: parseInt(summaryResult.rows[0]?.total_calls || "0"),
        totalMinutes: parseFloat(summaryResult.rows[0]?.total_minutes || "0"),
        totalCost: parseFloat(summaryResult.rows[0]?.total_cost || "0"),
      },
      breakdown,
      dailyUsage: dailyResult.rows.map(row => ({
        date: row.date,
        calls: parseInt(row.calls),
        minutes: parseFloat(row.minutes),
        cost: parseFloat(row.cost),
      })),
    };
  }
}