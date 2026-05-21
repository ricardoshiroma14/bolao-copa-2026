-- Allow pool members to see each other's predictions (transparency)
CREATE POLICY "Members see predictions of pool members"
ON public.predictions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pool_members me
    JOIN public.pool_members other ON other.pool_id = me.pool_id
    WHERE me.user_id = auth.uid()
      AND other.user_id = predictions.user_id
  )
);