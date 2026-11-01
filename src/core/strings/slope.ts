import { chartStrings } from '../strings';

const EN = {
  // reader-facing wording linked only by its consumers.
  "slopeDesc": "Slope chart, {v1} series from {v2} to {v3}. ",
  "seriesUnchanged": "All series unchanged.",
  "slopeTitle": "Slope chart: {v1} series, {v2} to {v3}",
  "slopeResponseRest": "{v1} and {v2} do not add to 100: the rest ({v3} per group and period) chose neither answer.",
  "slopeNetName": "Net",
  "changeHead": "Change",
  "slopeNetKey": " = {v1} − {v2} in {v3} (change vs {v4})",
  "slopeBaseNote": "Hatched: base below {v1} respondents ({v2}); read with care.",
  "divergingSlopeDesc": "Diverging slope chart, {v1} series, one panel per group, {v2} above and {v3} below zero, from {v4} to {v5}. ",
  "slopeNetRiseDesc": "Net score rose in {v1} of them; highest in {v2}: {v3} {v4}.",
  "slopeLowBaseDesc": " Low base: {v1}.",
  "divergingSlopeTitle": "Diverging slope chart: {v1} groups, {v2} to {v3}",
  "steepestRiser": "Steepest riser: {v1}",
  "steepestFaller": "steepest faller: {v1}",
  "slopeFoldHead": "{v1}: the {v2} series below {v3} of the endpoint total at both ends ",
  "slopeFoldSum": "summed to {v1} at {v2} and ",
  "slopeFoldEnd": "{v1} at {v2}.",
  "positiveName": "Positive",
  "negativeName": "Negative",
} as const;
const DE: { [K in keyof typeof EN]: string } = {
  // reader-facing wording linked only by its consumers.
  "slopeDesc": "Steigungsdiagramm, {v1} {v1|Reihe|Reihen} von {v2} bis {v3}. ",
  "seriesUnchanged": "Alle Reihen unverändert.",
  "slopeTitle": "Steigungsdiagramm: {v1} {v1|Reihe|Reihen}, {v2} bis {v3}",
  "slopeResponseRest": "{v1} und {v2} ergeben nicht 100. Der Rest ({v3} je Gruppe und Periode) wählte keine dieser Antworten.",
  "slopeNetName": "Netto",
  "changeHead": "Veränderung",
  "slopeNetKey": " = {v1} − {v2} in {v3} (Änderung vs {v4})",
  "slopeBaseNote": "Schraffiert: Basis unter {v1} {v1|Antwort|Antworten} ({v2}); vorsichtig lesen.",
  "divergingSlopeDesc": "Divergierendes Steigungsdiagramm, {v1} {v1|Reihe|Reihen}, ein Feld je Gruppe, {v2} über und {v3} unter null, von {v4} bis {v5}. ",
  "slopeNetRiseDesc": "Nettowert stieg in {v1} davon; höchster in {v2}: {v3} {v4}.",
  "slopeLowBaseDesc": " Niedrige Basis: {v1}.",
  "divergingSlopeTitle": "Divergierendes Steigungsdiagramm: {v1} {v1|Gruppe|Gruppen}, {v2} bis {v3}",
  "steepestRiser": "Stärkster Anstieg: {v1}",
  "steepestFaller": "stärkster Abfall: {v1}",
  "slopeFoldHead": "{v1}: die {v2} {v2|Reihe|Reihen} unter {v3} der Endpunktsumme an beiden Enden ",
  "slopeFoldSum": "zusammen {v1} bei {v2} und ",
  "slopeFoldEnd": "{v1} bei {v2}.",
  "positiveName": "Positiv",
  "negativeName": "Negativ",
};

export const { chartString } = chartStrings(EN, DE);
