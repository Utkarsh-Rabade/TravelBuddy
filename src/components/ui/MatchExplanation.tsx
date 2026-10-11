import { Feedback, GlassCard, SectionHeader } from '@/components/app/ui';

interface MatchExplanationProps {
  explanation: string;
  explanationLimitations?: string;
}

export default function MatchExplanation({ explanation, explanationLimitations }: MatchExplanationProps) {
  if (!explanation) return null;

  return (
    <GlassCard tone="info" className="tb-stack">
      <SectionHeader title="Match Explanation" description="WHY this companion was matched with this request." icon="info" />
      <p className="tb-small tb-min-zero whitespace-pre-line leading-7">{explanation}</p>
      {explanationLimitations && <Feedback tone="warning"><strong>Engine explanation limitations</strong><p className="mt-1 whitespace-pre-line">{explanationLimitations}</p></Feedback>}
    </GlassCard>
  );
}
