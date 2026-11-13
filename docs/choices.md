# Choices from application data

Choice fields can declare constant options or receive an owning option model in
their instance. The same popup handles scrolling, keyboard navigation, disabled
rows, pointer release and selection for both.

```dynlex
import ui/document_declarations.dl

document example:
    choice field "Worker" choosing "":

set instance to an instance of example
set options to a sequence copying [
    a UI option named "worker-1" displaying "Alex" enabled true,
    a UI option named "worker-2" displaying "Alex" enabled true
]
set the choices of "Worker" in (the address of instance) to options choosing "worker-2"
set selected to the selected choice of "Worker" in (the address of instance)
close the address of instance
```

Identities are unique, nonempty strings. Display labels may be duplicated and may
change independently of identity. Passing an empty identity selects nothing;
an empty model disables the field and leaves it without a popup. A model owns its labels and is
independent of temporary builders and other UI instances. Its immutable sequence
can share storage until the last owner closes.

Replacing a live model preserves the highlighted identity when it remains
available, and cancels an outstanding pointer press so replacing a row cannot
commit a different item. An unchanged model and selection do not invalidate the
view. Choosing an item emits the field's ordinary change event once. Programmatic
updates use the same value and label state without emitting an input event.

Existing numeric selection and text selection also work on model-backed fields.
Use the identity API to distinguish duplicate labels. A constant `choice "Fast"`
has `"Fast"` as its identity.
