import { chartStrings } from '../strings';

export const EN = {
  // reader-facing wording linked only by its consumers.
  "recurringEvent": "Recurring event",
  "overallSpan": "Overall span",
  "weekend": "Weekend",
  "elapsedToday": "Elapsed to today",
  "cadenceEvents": "{v1} cadence events",
  "workstream": "Workstream",
  "task": "Task",
  "milestone": "Milestone",
  "milestoneOnBar": "Milestone on a bar",
  "today": "Today",
  "eventName": "Event",
  "elapsed": "Elapsed",
  "todayDate": "Today, {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "recurringEvent": "Wiederkehrendes Ereignis",
  "overallSpan": "Gesamtzeitraum",
  "weekend": "Wochenende",
  "elapsedToday": "Vergangen bis heute",
  "cadenceEvents": "{v1} {v1|wiederkehrendes Ereignis|wiederkehrende Ereignisse}",
  "workstream": "Arbeitsstrang",
  "task": "Aufgabe",
  "milestone": "Meilenstein",
  "milestoneOnBar": "Meilenstein auf einem Balken",
  "today": "Heute",
  "eventName": "Ereignis",
  "elapsed": "Vergangen",
  "todayDate": "Heute, {v1}",
};

export const { chartString } = chartStrings(EN, DE);
