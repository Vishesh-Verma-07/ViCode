# ViCode

ViCode is a conversational CLI coding partner built to help you think through problems, create a plan, and build the solution with you in control every step of the way. Instead of jumping straight into code, ViCode guides you through a structured workflow that keeps you focused on the problem, not the tool. 

---

## Get Started

Install ViCode globally: 

```bash
npm i -g vi-code
```

Then run it inside your project directory: 

```bash
vicode
```

Need help? Run `/help` directly inside of ViCode! 


---


## How ViCode Works

ViCode's workflow is split into three distinct modes to ensure you're always in the driver's seat: 

1. **Discuss** - Talk through your idea, bug, or feature in natural language. ViCode will ask clarifying questions, poke holes in your thinking, and help refine your requirements before any code is written. 

2. **Plan** - Turn your conversation into a concrete, actionable plan. ViCode will break down the work into steps, highlight trade-offs, and allow you to review and tweak the plan to your liking before execution.

3. **Build** - Execute the approved plan step by step. ViCode will make targeted edits, follow your project's conventions, and verify its changes when possible, all whilst keeping its output concise and transparent. 

This cycle allows for rapid iteration without sacrificing intentionality. 


---


## Key Features

- **Mode Driven Workflow** - Explicitly switch between Discuss, Plan, and Build modes to set intent. No guessing on if you're brainstorming or coding. 
- **Plan First Execution** - Nothing is implemented until you approve a plan. This allows for full control over scope and direction.
- **Repo Aware** - Mimics your existing code style, patterns, and utilities by reading your codebase, never assuming a framework or dependency.
- **Git Safe** - ViCode will never commit, push, or amend changes without your explicit request.
- **Concise By Design** - Built for the terminal. Expect short responses with reasoning only when necessary for the task at hand.
- **Skill Extensible** - Packed with specialized skills (e.g reviews, triage, prototyping, and more) that can be loaded on demand to fit your task.
- **Terminal Native** - Blazing fast, interactive, and built to be used where you already develop. 


---


## Why ViCode?

- **Stay in control.** You approve the plan, you decide the direction, and you choose when to build. 
- **Avoid wasted work.** Catch ambiguity early in Discuss, solidify it in Plan, and execute with precision in Build. 
- **Fits your repo.** No boilerplate generation that goes against your conventions. ViCode adapts to your project, not the other way around.
- **Built for engineers.** Minimal fluff, security conscious, and designed to get out of your way whilst still being a thought partner. 

Ready to get started? `npm i -g vi-code` and run `vicode` in your project today!