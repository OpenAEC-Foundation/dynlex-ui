# Scoped keyboard commands

Keyboard commands share control handlers and callback contexts. Bind a command to
an element; dispatch starts at the focused control and walks its retained parents.
The first enabled scope with that binding handles the key. Sibling panes remain
independent. Disabled action targets retain their ordinary activation policy.

```text
import ui/key_bindings.dl

bind UI key 257 with modifiers 2 from source in window activating run button
```

This binds Control+Enter to the Run control. Application code can instead declare a
callback inside its document's `code:` section:

```text
when the "Source" control receives key 70 with modifiers 2:
    set the text of "Status" in this window to "Find requested"
```

Command callbacks receive a `UI view`; control callbacks receive a `UI instance`.
`this window` resolves the owning instance for either receiver, including canvas
callbacks. Per-binding context uses the same nested event context stack as buttons.
Use `bind UI key ... to callback with context pointer` for library controllers, and
`unbind UI key ... from scope in window` to remove a binding.

Normalized keys use the shared key range 0–511. Modifier bits are Shift=1,
Control=2, Alt=4 and Super=8; lock bits do not affect binding lookup. Composition
retains the platform input context and does not dispatch commands.

`consume the UI key in view` reports a handled key and ends shared key dispatch.
Clearing `key press` alone can stop dispatch while preserving the platform's
character/default action, as required for writable Space and clipboard paste.
The browser suppresses its default only when shared dispatch reports handling;
it does not maintain a separate shortcut allowlist.

Platforms normally use `queue UI input ... in view`. A caller that needs the result
uses `deliver UI input ... in view`, which updates the view and returns that event's
handled flag. An asynchronous queue caller can provide `replying to delivery`;
it owns that record until status 2 (delivered) or 3 (cancelled on close). Status 0
is fresh and 1 is queued. Another event cannot reuse a queued delivery. Completion
belongs to each event, even when later events run during the same update.
