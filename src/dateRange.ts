/**
 * adAnalytics dateRange value. LinkedIn's Restli parser needs literal
 * parens, colons and commas here; percent-encoding them returns 400 PARAM_INVALID.
 */
export function buildDateRange(startDate: string, endDate: string): string {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  return `(start:(year:${sy},month:${sm},day:${sd}),end:(year:${ey},month:${em},day:${ed}))`;
}
