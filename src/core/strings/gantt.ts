import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "recurringEvent": "Recurring event",
  "overallSpan": "Overall span",
  "weekend": "Weekend",
  "elapsedToday": "Elapsed to today",
  "ganttTitle": "Gantt: {v1} activities",
  "cadenceEvents": "{v1} cadence events",
  "ganttDesc": "Gantt chart at {v1} scale from {v2} to {v3}. {v4}.",
  "workstream": "Workstream",
  "task": "Task",
  "milestone": "Milestone",
  "milestoneOnBar": "Milestone on a bar",
  "today": "Today",
  "eventName": "Event",
  "elapsed": "Elapsed",
  "todayDate": "Today, {v1}",
  "cadenceSummary": "{v1} {v2} cadence events from {v3} to {v4}",
  "ganttDays": "days",
  "ganttWeeks": "weeks",
  "ganttMonths": "months",
  "ganttQuarters": "quarters",
  "ganttYears": "years",
  "sharedMilestonesSummary": "Shared milestones {v1}",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "recurringEvent": "Wiederkehrendes Ereignis",
  "overallSpan": "Gesamtzeitraum",
  "weekend": "Wochenende",
  "elapsedToday": "Vergangen bis heute",
  "ganttTitle": "Gantt: {v1} {v1|Aktivität|Aktivitäten}",
  "cadenceEvents": "{v1} {v1|wiederkehrendes Ereignis|wiederkehrende Ereignisse}",
  "ganttDesc": "Gantt-Diagramm mit Skala {v1} von {v2} bis {v3}. {v4}",
  "workstream": "Arbeitsstrang",
  "task": "Aufgabe",
  "milestone": "Meilenstein",
  "milestoneOnBar": "Meilenstein auf einem Balken",
  "today": "Heute",
  "eventName": "Ereignis",
  "elapsed": "Vergangen",
  "todayDate": "Heute, {v1}",
  "cadenceSummary": "{v1}, wiederkehrende Ereignisse: {v2}, von {v3} bis {v4}",
  "ganttDays": "Tage",
  "ganttWeeks": "Wochen",
  "ganttMonths": "Monate",
  "ganttQuarters": "Quartale",
  "ganttYears": "Jahre",
  "sharedMilestonesSummary": "Gemeinsame Meilensteine {v1}",
};

export const { chartString } = chartStrings(EN, DE);
