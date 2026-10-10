import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorMessage } from "@/api/client";
import { keys, login } from "@/api/queries";
import { AuthLayout } from "@/components/auth-layout";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { S } from "@/strings.zh";

type Errors = { username?: string; password?: string };

export function LoginPage() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const signIn = useMutation({
    mutationFn: login,
    onSuccess: (user) => queryClient.setQueryData(keys.me, user),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Errors = {};
    if (!username.trim()) found.username = S.auth.usernameRequired;
    if (!password) found.password = S.auth.passwordRequired;
    setErrors(found);
    if (Object.keys(found).length === 0) signIn.mutate({ username: username.trim(), password });
  }

  return (
    <AuthLayout title={S.login.title} description={S.login.description}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormField
          label={S.auth.username}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={errors.username}
          autoComplete="username"
          autoFocus
        />
        <FormField
          label={S.auth.password}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          autoComplete="current-password"
        />
        <FormError message={signIn.isError ? errorMessage(signIn.error) : null} />
        <Button type="submit" className="w-full" disabled={signIn.isPending}>
          {signIn.isPending ? S.login.submitting : S.login.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}
