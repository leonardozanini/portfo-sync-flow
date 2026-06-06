-- Explicit restrictive policy: only admins can write to user_roles
CREATE POLICY "roles_no_self_escalation" ON public.user_roles
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));