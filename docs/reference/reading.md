# Chart reading counts

`boardplot render` and `boardplot_render` return `reading.counts` with each chart.
This array records structural counts from the layout that writes the accessible
description. It is empty when the description has no structural count phrase.
It does not parse authored text or change the description.

| Field | Type | Meaning |
|---|---|---|
| `what` | string enum | The thing counted, such as `categories`, `series`, `causes`, or `rows`. |
| `n` | nonnegative integer | The count used in the description. |
| `text` | string | The exact phrase in the accessible description. Match this phrase to identify the count. |

For example, a Pareto description that says `5 causes sorted descending` returns:

```json
{ "what": "causes", "n": 5, "text": "5 causes sorted descending" }
```

Counts describe the accepted layout. A folded Pareto can report both the number
of causes and the number of drawn columns. Counts can repeat when several
phrases describe the same kind of item. They are not measured values or claims
that need a source-data match. Other numbers in the description still need their
normal checks.

`boardplot describe <type> --full` returns the count schema under `reading.counts`.
The MCP render output schema contains the same schema. The TypeScript type is
`StructureCount`; `ChartReading.counts` is an array of this type.
