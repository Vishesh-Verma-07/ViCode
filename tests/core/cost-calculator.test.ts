import { describe, it, expect } from "bun:test"
import {
  addCost,
  calculateCost,
  formatCost,
  formatTokens,
  type ModelPricing,
} from "@/core/cost-calculator"

const PRICING: ModelPricing = {
  inputPricePerToken: 3 / 1_000_000,
  outputPricePerToken: 15 / 1_000_000,
}

describe("cost-calculator", () => {
  describe("calculateCost", () => {
    it("calculates cost for a known model", () => {
      const cost = calculateCost({ inputTokens: 1000, outputTokens: 500 }, PRICING)
      expect(cost).toBeCloseTo(0.0105, 6)
    })

    it("prices a free model as zero rather than unknown", () => {
      const free: ModelPricing = { inputPricePerToken: 0, outputPricePerToken: 0 }
      const cost = calculateCost({ inputTokens: 1000, outputTokens: 500 }, free)
      expect(cost).toBe(0)
    })

    it("reports null when the Model has no known price", () => {
      const cost = calculateCost({ inputTokens: 1000, outputTokens: 500 }, null)
      expect(cost).toBeNull()
    })

    it("handles zero tokens", () => {
      const cost = calculateCost({ inputTokens: 0, outputTokens: 0 }, PRICING)
      expect(cost).toBe(0)
    })

    it("handles large token counts", () => {
      const cost = calculateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, PRICING)
      expect(cost).toBeCloseTo(18, 2)
    })

    it("prices cache reads at the cache rate, not the input rate", () => {
      const pricing: ModelPricing = {
        inputPricePerToken: 10 / 1_000_000,
        outputPricePerToken: 10 / 1_000_000,
        cacheReadPricePerToken: 1 / 1_000_000,
      }
      const cost = calculateCost({ inputTokens: 1000, outputTokens: 0, cacheReadTokens: 1000 }, pricing)
      expect(cost).toBeCloseTo(0.001, 6)
    })

    it("prices cache writes at the cache rate, not the input rate", () => {
      const pricing: ModelPricing = {
        inputPricePerToken: 10 / 1_000_000,
        outputPricePerToken: 10 / 1_000_000,
        cacheWritePricePerToken: 12 / 1_000_000,
      }
      const cost = calculateCost(
        { inputTokens: 1000, outputTokens: 0, cacheWriteTokens: 1000 },
        pricing,
      )
      expect(cost).toBeCloseTo(0.012, 6)
    })

    it("bills cache reads, cache writes, and uncached input together", () => {
      const pricing: ModelPricing = {
        inputPricePerToken: 10 / 1_000_000,
        outputPricePerToken: 10 / 1_000_000,
        cacheReadPricePerToken: 1 / 1_000_000,
        cacheWritePricePerToken: 12 / 1_000_000,
      }
      const cost = calculateCost(
        {
          inputTokens: 1000,
          outputTokens: 0,
          cacheReadTokens: 400,
          cacheWriteTokens: 300,
        },
        pricing,
      )
      // 400 reads @1 + 300 writes @12 + 300 uncached @10, per million.
      expect(cost).toBeCloseTo((400 * 1 + 300 * 12 + 300 * 10) / 1_000_000, 9)
    })

    it("falls back to the input rate when the catalog has no cache rate", () => {
      const cost = calculateCost(
        { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 1000 },
        PRICING,
      )
      expect(cost).toBeCloseTo(0.003, 6)
    })

    it("clamps cache tokens that exceed the input count instead of going negative", () => {
      const cost = calculateCost(
        { inputTokens: 100, outputTokens: 0, cacheReadTokens: 1000, cacheWriteTokens: 1000 },
        PRICING,
      )
      expect(cost).toBeCloseTo(0.0003, 6)
    })
  })

  describe("addCost", () => {
    it("sums two known costs", () => {
      expect(addCost(0.01, 0.02)).toBeCloseTo(0.03, 6)
    })

    it("keeps an unknown total unknown rather than pretending the other half was free", () => {
      expect(addCost(null, 0.02)).toBeNull()
      expect(addCost(0.02, null)).toBeNull()
      expect(addCost(null, null)).toBeNull()
    })

    it("treats zero as known, so a free turn keeps the total known", () => {
      expect(addCost(0.02, 0)).toBe(0.02)
    })
  })

  describe("formatCost", () => {
    it("formats zero cost", () => {
      expect(formatCost(0)).toBe("$0.00")
    })

    it("renders an unknown cost as a dash, distinct from a free one", () => {
      expect(formatCost(null)).toBe("—")
      expect(formatCost(null)).not.toBe(formatCost(0))
    })

    it("formats small cost in cents", () => {
      expect(formatCost(0.005)).toBe("$0.005")
    })

    it("formats cost under $1", () => {
      expect(formatCost(0.042)).toBe("$0.042")
    })

    it("formats cost over $1", () => {
      expect(formatCost(1.23)).toBe("$1.23")
    })

    it("formats cost over $100", () => {
      expect(formatCost(123.45)).toBe("$123.45")
    })
  })

  describe("formatTokens", () => {
    it("formats small token counts", () => {
      expect(formatTokens(0)).toBe("0")
      expect(formatTokens(1)).toBe("1")
      expect(formatTokens(999)).toBe("999")
    })

    it("formats thousands with k suffix", () => {
      expect(formatTokens(1000)).toBe("1.0k")
      expect(formatTokens(1500)).toBe("1.5k")
      expect(formatTokens(10000)).toBe("10.0k")
      expect(formatTokens(999999)).toBe("1000.0k")
    })

    it("formats millions with m suffix", () => {
      expect(formatTokens(1_000_000)).toBe("1.0m")
      expect(formatTokens(2_500_000)).toBe("2.5m")
    })
  })
})