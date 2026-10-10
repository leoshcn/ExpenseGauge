import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorMessage, isApiError } from "@/api/client";
import { createFirstUser, keys } from "@/api/queries";
import { AuthLayout } from "@/components/auth-layout";
import { FormError, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { S } from "@/strings.zh";

const MIN_PASSWORD = 8; // CredentialsIn.password minLength in backend/openapi.json

type Errors = { username?: string; password?: string; confirm?: string };

function validate(username: string, password: string, confirm: string): Errors {
  const errors: Errors = {};
  if (!username.trim()) errors.username = S.auth.usernameRequired;
  if (password.length < MIN_PASSWORD) errors.password = S.auth.passwordTooShort;
  if (confirm !== password) errors.confirm = S.auth.passwordMismatch;
  return errors;
}

/** Open only while no user exists; `POST /setup` also signs the new user in. */
export function SetupPage() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const create = useMutation({
    mutationFn: createFirstUser,
    onSuccess: (user) => {
      queryClient.setQueryData(keys.setupStatus, { user_exists: true });
      queryClient.setQueryData(keys.me, user);
    },
    onError: (error) => {
      // Someone else finished setup first: re-read the status, the guard sends us to login.
      if (isApiError(error, "USER_ALREADY_EXISTS")) {
        void queryClient.invalidateQueries({ queryKey: keys.setupStatus });
      }
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate(username, password, confirm);
    setErrors(found);
    if (Object.keys(found).length === 0) create.mutate({ username: username.trim(), password });
  }

  return (
    <AuthLayout title={S.setup.title} description={S.setup.description}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormField
          label={S.auth.username}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={errors.username}
          autoComplete="username"
          maxLength={64}
          autoFocus
        />
        <FormField
          label={S.auth.password}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          hint={S.setup.passwordHint}
          autoComplete="new-password"
          maxLength={200}
        />
        <FormField
          label={S.setup.confirmPassword}
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={errors.confirm}
          autoComplete="new-password"
          maxLength={200}
        />
        <FormError message={create.isError ? errorMessage(create.error) : null} />
        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending ? S.setup.submitting : S.setup.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}
