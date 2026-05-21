DROP POLICY IF EXISTS "Members see pool predictions after kickoff" ON public.predictions;

CREATE POLICY "Members see pool predictions after kickoff"
ON public.predictions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM pool_members me
    JOIN pool_members other ON other.pool_id = me.pool_id
    WHERE me.user_id = auth.uid()
      AND other.user_id = predictions.user_id
  )
  AND EXISTS (
    SELECT 1
    FROM matches m
    WHERE m.id = predictions.match_id
      AND (m.kickoff_at <= now() OR m.status IN ('live','finished'))
  )
);