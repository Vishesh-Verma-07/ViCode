import { describe, it, expect } from "bun:test"
import { TAB_MIN_WIDTH, hitTestTabBar, layoutTabBar, type TabBarTab } from "@/ui/tab-bar-layout"

function tabsWhere(
  count: number,
  title: (index: number) => string,
  active: number,
): TabBarTab[] {
  return Array.from({ length: count }, (_, index) => ({
    title: title(index),
    active: index === active,
  }))
}

function indices(slots: ReturnType<typeof layoutTabBar>): number[] {
  return slots.map((slot) => slot.index)
}

function widths(slots: ReturnType<typeof layoutTabBar>): number[] {
  return slots.map((slot) => slot.width)
}

describe("Tab Bar layout", () => {
  it("gives every title its full width while the Tabs all fit", () => {
    const slots = layoutTabBar(
      [
        { title: "alpha", active: false },
        { title: "beta", active: true },
      ],
      40,
    )

    expect(indices(slots)).toEqual([0, 1])
    expect(widths(slots)).toEqual([9, 8]) // title + " × " / "   "
  })

  it("counts the + control when deciding whether the Tabs fit", () => {
    const tabs: TabBarTab[] = [
      { title: "alpha", active: false },
      { title: "beta", active: true },
    ]

    expect(indices(layoutTabBar(tabs, 18))).toEqual([0, 1])
    expect(indices(layoutTabBar(tabs, 17))).toEqual([1])
  })

  it("shrinks crowded Tabs evenly, down to the readable floor", () => {
    const tabs = tabsWhere(8, () => "a title far too long", 0)

    const roomy = layoutTabBar(tabs, 120)
    expect(indices(roomy)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(widths(roomy)).toEqual([14, 14, 14, 14, 14, 14, 14, 14])

    const atFloor = layoutTabBar(tabs, 100)
    expect(indices(atFloor)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(widths(atFloor)).toEqual(new Array(8).fill(TAB_MIN_WIDTH))
  })

  it("scrolls past the floor so the active Tab stays in view", () => {
    const tabs = tabsWhere(8, () => "a title far too long", 7)

    const slots = layoutTabBar(tabs, 80)
    expect(indices(slots)).toEqual([2, 3, 4, 5, 6, 7])
    expect(widths(slots)).toEqual(new Array(6).fill(TAB_MIN_WIDTH))
  })

  it("divides a strip narrower than the floor down to a smaller slot", () => {
    const tabs = tabsWhere(2, (index) => (index === 0 ? "alpha" : "beta"), 1)

    const slots = layoutTabBar(tabs, 10)
    expect(indices(slots)).toEqual([1])
    expect(widths(slots)).toEqual([9])
  })

  it("keeps whichever Tab is active in view at every width", () => {
    for (let width = 1; width <= 120; width++) {
      for (let active = 0; active < 12; active++) {
        const tabs = tabsWhere(12, (index) => `a title far too long ${index}`, active)
        expect(indices(layoutTabBar(tabs, width))).toContain(active)
      }
    }
  })
})

describe("Tab Bar hit testing", () => {
  const tabs: TabBarTab[] = [
    { title: "alpha", active: false },
    { title: "beta", active: true },
  ]

  it("maps a column inside a Tab to that Tab", () => {
    // " alpha   " then " beta × " — beta starts at column 9.
    expect(hitTestTabBar(tabs, 80, 0)).toEqual({ kind: "tab", index: 0, close: false })
    expect(hitTestTabBar(tabs, 80, 5)).toEqual({ kind: "tab", index: 0, close: false })
    expect(hitTestTabBar(tabs, 80, 9)).toEqual({ kind: "tab", index: 1, close: false })
    expect(hitTestTabBar(tabs, 80, 13)).toEqual({ kind: "tab", index: 1, close: false })
  })

  it("names the × cell only on the active Tab", () => {
    // beta: pad, title, space, × at column 9 + 6 = 15.
    expect(hitTestTabBar(tabs, 80, 15)).toEqual({ kind: "tab", index: 1, close: true })
    // alpha is inactive, so its last two cells are pad, not a close target.
    expect(hitTestTabBar(tabs, 80, 7)).toEqual({ kind: "tab", index: 0, close: false })
  })

  it("puts + directly after the last visible Tab", () => {
    expect(hitTestTabBar(tabs, 80, 17)).toEqual({ kind: "plus" })
    expect(hitTestTabBar(tabs, 80, 18)).toBeNull()
  })

  it("accounts for a status marker shifting the title and ×", () => {
    const withStatus: TabBarTab[] = [
      { title: "approval", active: true, status: "approval" },
    ]
    // "⚠  approval × ": marker (2) + pad (1) + title (8) + space (1) = × at 12.
    expect(hitTestTabBar(withStatus, 80, 12)).toEqual({
      kind: "tab",
      index: 0,
      close: true,
    })
    expect(hitTestTabBar(withStatus, 80, 11)).toEqual({ kind: "tab", index: 0, close: false })
    expect(hitTestTabBar(withStatus, 80, 14)).toEqual({ kind: "plus" })
  })

  it("accounts for a truncated title when locating ×", () => {
    const narrow: TabBarTab[] = [{ title: "a title far too long", active: true }]
    // width 10 leaves a 9-cell slot: " a tit… × " with × at column 7.
    expect(hitTestTabBar(narrow, 10, 7)).toEqual({
      kind: "tab",
      index: 0,
      close: true,
    })
    expect(hitTestTabBar(narrow, 10, 9)).toEqual({ kind: "plus" })
  })

  it("uses the scrolled window's positions for its Tabs", () => {
    const crowded = tabsWhere(8, () => "a title far too long", 7)
    const slots = layoutTabBar(crowded, 80)
    // The first visible slot is Tab 2 in the set, but column 0 on the Bar.
    expect(hitTestTabBar(crowded, 80, 0)?.kind).toBe("tab")
    expect(hitTestTabBar(crowded, 80, 0)).toMatchObject({ index: slots[0]!.index })
    expect(slots[0]!.index).toBe(2)
  })

  it("ignores columns left of the Bar", () => {
    expect(hitTestTabBar(tabs, 80, -1)).toBeNull()
  })
})
