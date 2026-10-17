/** An A/B report is comparable only when every planned model/case arm succeeds. */
export function missingComparisonArms(models, cases, rows) {
  const missing = [];
  for (const model of models) {
    for (const caseName of cases) {
      const matches = rows.filter(
        (row) => row.model === model && row.case === caseName,
      );
      if (matches.length !== 1 || matches[0]?.ok !== true)
        missing.push(`${model}/${caseName}`);
    }
  }
  return missing;
}
