# Conventions

## Every user-facing string ships in Arabic

The UI is bilingual: `LangProvider` flips `<html dir>` and a `font-arabic` class,
and `t()` / `<Bi>` / `<BiInline>` look the English text up in
`lib/translations.ts`. A missing key falls back to English **silently** — the
label just renders in English inside an otherwise Arabic page.

So when you add or change UI:

1. Route the string through `t('…')` or `<BiInline en="…" />`. Never put bare
   English in JSX, and never in a string prop that a component renders raw.
2. Add the English → Arabic pair to `lib/translations.ts`.
3. Run `npm run check:i18n`. It fails the moment a string has no translation.

Strings passed through a variable — `t(row.label)` — are invisible to the
checker. Keep those label constants as plain literals in the same file and add
their Arabic by hand.

## Layout must survive `dir="rtl"`

Use logical Tailwind utilities, not physical ones, so the layout mirrors itself:

| don't | do |
|---|---|
| `ml-*` `mr-*` | `ms-*` `me-*` |
| `pl-*` `pr-*` | `ps-*` `pe-*` |
| `text-left` `text-right` | `text-start` `text-end` |
| `border-l` `border-r` | `border-s` `border-e` |
| `rounded-l-*` `rounded-r-*` | `rounded-s-*` `rounded-e-*` |

`left-*` / `right-*` stay physical, so an absolutely positioned element and its
offset must agree: either flip both (`ltr:left-0 rtl:right-0`) or leave both
physical, never one of each.

Two more things that only show up in Arabic:

- **`letterSpacing` breaks Arabic.** It pulls the glyphs apart and cuts the
  joins between them. Apply it only to Latin text: `letterSpacing={isAr ? 0 : 1.4}`.
- **Left and right are not fixed.** A grid or flex row mirrors under RTL, so copy
  that says "praise on the left" becomes wrong. Write the Arabic to match where
  the content actually lands, or avoid naming a side.

Check a change in both languages before calling it done — the toggle is in the
header.
