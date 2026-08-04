export function ScoreBadge({
  score,
  label = "Overall",
}: {
  score: number;
  label?: string;
}) {
  const tone = score >= 4 ? "strong" : score >= 3 ? "qualified" : "weak";
  return (
    <span className={`score-badge score-${tone}`}>
      <span>{label}</span>
      <strong>{score}/5</strong>
    </span>
  );
}
