# 0014: A File Mention Becomes a File Attachment

## Status

Accepted

## Context

ViCode had no way to point the model at a file except by naming it in prose and hoping the model called `read_file`. The gap was written down in `upcoming.md` as "No `@` file mentions", and the feature request that closed it asked for the interaction OpenCode and Claude Code already have: type `@`, pick a project file from a dropdown, and have that file's content reach the model.

The cheap implementation is a rewriting one. `@path` is replaced by its plain path in the submitted text, the message goes out unchanged, and the model calls `read_file` if it decides the file matters. That is nearly free to build — the draft already knows the path — and it is wrong in a way worth recording. A user who types `@src/parser.ts` has already decided the file matters; making the model spend a Tool Call to re-decide it both costs a round-trip and hands the decision back to the model, which may read a different file, read it partially, or not read it at all. An attachment that sometimes attaches nothing is worse than no feature, because the user cannot tell which happened.

Two questions followed from carrying the content instead of the path. First, where does the content live? It has to survive the turn: the model reads it on the next request, the Session is saved and resumed, and Compaction may fold the message into a summary. A path string survives all three trivially; content does not, so it needs to be a first-class part of the message rather than transient send-time text.

Second, is a mention a read that owes the Approval Rule? The rule already pauses a `read_file` of a Sensitive Path or a path outside the Project Root. The tempting answer is that typing a path *is* consent — the user named it, so read it. That answer fails on the autocomplete: the File Suggestion can offer a file and the user can accept it without ever reading the path it holds, so `@.env` and `.env` typed by hand and `.env` accepted from the list are not distinguishable acts, and only the first is a considered one. The alternative justification — that the dropdown already hides Sensitive Paths, so an accepted mention is never one — only covers the accepted case: a path typed out in full remains a hand-written `read_file` of that path in every respect, and exempting it because it arrived through the Input Box rather than a Tool Call would be a consent rule enforced by spelling rather than by what is being reached.

## Decision

A File Mention resolves to a File Attachment, and the read it names is approval-gated exactly as a `read_file` of that path would be.

- **The mention carries the content, not the path.** On send, `detectMention`/`extractMentions` find every word-start `@path` token, the named file is read once, and its content is attached to the user message. `composeFileAttachmentText` renders it verbatim inside a `<file path="...">` tag with no line numbers, so an exact-string edit the model copies out of the attachment is an exact-string edit against the real file — the same property `read_file` output has, kept for the same reason.
- **The attachment is a message content block, not send-time text.** `FileAttachmentContent` (`{ type: "file-attachment", path, content }`) joins the `Content` union, so it is persisted in the Session JSON, counted by `estimateMessageTokens` and Compaction, and survives the round-trip untouched. The block is the fact; the `<file>` tag is only how it reaches a Provider.
- **A mention of a Sensitive Path or a path outside the Project Root pauses for approval.** The pause reuses the Approval Prompt and the per-Path memory the Agent Loop already runs: approving `@.env` also approves the model's later `read_file` of `.env` in the same Turn. This is not a new case of the Approval Rule — a mention is a read of a path, and the two path cases already say what happens to that. Declining is not an error: the file is skipped and a note says so, and the message is sent with or without it.
- **The File Suggestion never offers a Sensitive Path.** An autocomplete is a list of what is easy to grab; a Sensitive Path is never easy to grab, and offering one would invite a one-key approval of a credential store. A hand-typed sensitive path still asks, because the dropdown's restraint does not reach it.
- **An unreadable mention attaches nothing and says why.** A typo, a directory, a binary, or a read that failed produces one feedback line, and the message still goes out. Silence is the failure mode this avoids: a mention that attaches nothing while looking like it did would leave the user believing the model had read a file it never saw.
- **A mention completes the draft; it does not send it.** A mention is one word of a message, so `Enter` on the highlighted suggestion replaces the token and leaves the floor open. This is where the File Suggestion deliberately diverges from the Command Suggestion, whose `Enter` runs the command: a command is the whole input, a mention is a part of one.

## Consequences

- **Positive**: the user's stated intent — "read this file" — is honoured without spending a Tool Call, and it is honoured visibly: the attachment renders as a compact `@path · N lines` chip with no bodies to scroll past, while the model receives the content.
- **Positive**: the content is a message part like any other, so nothing downstream needed a second path. Session persistence, token estimation, Compaction's transcript, and the Provider conversion each learned one `else if` and the feature worked in resumed and compacted sessions for free.
- **Positive**: consent stays in one place. A mention is gated by the two existing path cases rather than by a third case invented for a UI affordance, so the Approval Rule still has one shape, and approving the mention spares the model's own read of the same path the second prompt.
- **Negative**: an attachment can duplicate what the model asks for anyway. If it ignores the attached content and calls `read_file` on the same path, the file is in the context twice. The cap keeps the duplication bounded, and the alternative — suppressing the Tool itself — would be the agent overriding the model's own request.
- **Negative**: the attachment is stored in the Session JSON, so a large `@`-ed file makes the session file correspondingly larger, once per mention that produced it. The 64 KiB cap is the ceiling per attachment, not per session.
- **Negative**: a mention is a read the user did not explicitly authorise at the moment it happens. The autocomplete case is the reason this is worth the prompt, but it does mean a workflow that mentions several sensitive files in one message collects a prompt for each — one per path per Turn, like the file Tools themselves.
