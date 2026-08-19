import { describe, it, expect } from "bun:test"
import {
  calculateCost,
  formatCost,
  formatTokens,
  type ModelPricing,
} from "./cost-calculator"

describe("cost-calculator", () => {
  describe("calculateCost", () => {
    it("calculates cost for a known model", () => {
      const pricing: ModelPricing = {
        inputPricePerToken: 3 / 1_000_000,
        outputPricePerToken: 15 / 1_000_000,
      }
      const cost = calculateCost(1000, 500, pricing)
      expect(cost).toBeCloseTo(0.0105, 6)
    })

    it("returns 0 when pricing is null", () => {
      const cost = calculateCost(1000, 500, null)
      expect(cost).toBe(0)
    })

    it("handles zero tokens", () => {
      const pricing: ModelPricing = {
        inputPricePerToken: 3 / 1_000_000,
        outputPricePerToken: 15 / 1_000_000,
      }
      const cost = calculateCost(0, 0, pricing)
      expect(cost).toBe(0)
    })

    it("handles large token counts", () => {
      const pricing: ModelPricing = {
        inputPricePerToken: 3 / 1_000_000,
        outputPricePerToken: 15 / 1_000_000,
      }
      const cost = calculateCost(1_000_000, 1_000_000, pricing)
      expect(cost).toBeCloseTo(18, 2)
    })
  })

  describe("formatCost", () => {
    it("formats zero cost", () => {
      expect(formatCost(0)).toBe("$0.00")
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
