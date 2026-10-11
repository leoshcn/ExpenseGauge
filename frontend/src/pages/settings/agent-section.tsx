import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { errorMessage, type Schemas } from "@/api/client";
import { createToken, keys, revokeToken, tokensQuery } from "@/api/queries";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { ErrorState } from "@/components/error-state";
import { FormError } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useRestoreFocus } from "@/hooks/use-restore-focus";
import { formatDateTime } from "@/lib/date";
import { S } from "@/strings.zh";

import { activeFirst, hermesConfig, mcpEndpoint } from "./model";
import { SectionCard } from "./section-card";

const C = S.settings.agent.connection;
const T = S.settings.agent.tokens;

function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={cn("min-w-0 rounded-md bg-muted px-2 py-1 font-mono text-[13px] break-all", className)}>
      {children}
    </code>
  );
}

/** What an agent needs to connect: the MCP endpoint, the header, the channel IDs. */
function ConnectionCard({ channels }: { channels: readonly Schemas["ChannelOut"][] }) {
  const endpoint = mcpEndpoint(globalThis.location?.origin ?? "");
  const config = hermesConfig(endpoint, C.tokenPlaceholder);
  const label = "text-xs font-medium text-muted-foreground";

  return (
    <SectionCard title={C.title} description={C.description}>
      <dl className="grid gap-5 border-t px-4 py-5 sm:px-5 md:grid-cols-[10rem_1fr] md:gap-x-6">
        <dt className={cn(label, "md:pt-1.5")}>{C.endpoint}</dt>
        <dd className="-mt-3 flex items-center gap-2 md:mt-0">
          <Code>{endpoint}</Code>
          <CopyButton value={endpoint} label={C.endpointLabel} variant="ghost" />
        </dd>

        <dt className={cn(label, "md:pt-1.5")}>{C.auth}</dt>
        <dd className="-mt-3 md:mt-0">
          <Code>{C.authValue}</Code>
        </dd>

        <dt className={cn(label, "md:pt-2")}>{C.channels}</dt>
        <dd className="-mt-3 space-y-2 md:mt-0">
          {channels.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {channels.map((channel) => (
                <li key={channel.id} className="flex items-center gap-3 py-1.5 pr-1.5 pl-3">
                  <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                  <Code className="num px-1.5 py-0.5">{channel.id}</Code>
                  <CopyButton
                    value={String(channel.id)}
                    label={S.settings.channels.idLabel(channel.name)}
                    variant="ghost"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{C.noChannels}</p>
          )}
          <p className="text-xs text-muted-foreground">{C.channelsHint}</p>
        </dd>

        <dt className={cn(label, "md:pt-2")}>{C.config}</dt>
        <dd className="-mt-3 md:mt-0">
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg border bg-muted/60 p-3 pr-12 font-mono text-[13px] leading-5">
              {config}
            </pre>
            <div className="absolute top-1.5 right-1.5">
              <CopyButton value={config} label={C.configLabel} variant="ghost" />
            </div>
          </div>
        </dd>
      </dl>
    </SectionCard>
  );
}

/** The token value, once. It is kept only in this dialog's props and gone when it closes. */
function CreatedTokenDialog({ token, onClose }: { token: Schemas["TokenCreatedOut"]; onClose: () => void }) {
  useRestoreFocus();
  const D = T.created;
  const id = useId();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        closeLabel={S.common.close}
        // A stray click outside must not throw the only copy of the token away.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{D.title}</DialogTitle>
          <DialogDescription>{D.description(token.name)}</DialogDescription>
        </DialogHeader>
        <div role="alert" className="flex gap-3 rounded-lg bg-warning-soft p-3 text-warning-foreground">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="font-medium">{D.warningTitle}</p>
            <p className="text-[13px] leading-5">{D.warning}</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id}>{D.tokenLabel}</Label>
          <div className="flex items-start gap-2">
            <Textarea
              id={id}
              readOnly
              value={token.token}
              rows={2}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-0 resize-none font-mono text-[13px] break-all"
              spellCheck={false}
            />
            <CopyButton value={token.token} label={D.tokenLabel} showText variant="default" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {D.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TokenRow({ token, onRevoke }: { token: Schemas["TokenOut"]; onRevoke: () => void }) {
  const revoked = token.revoked_at !== null;
  return (
    <li className={cn("flex items-center gap-3 border-t px-4 py-3 sm:px-5", revoked && "text-muted-foreground")}>
      <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 truncate font-medium", revoked && "line-through decoration-1")}>{token.name}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 text-[11px] leading-[1.125rem] font-medium",
              revoked ? "border font-normal" : "bg-accent text-accent-foreground",
            )}
          >
            {revoked ? T.revoked : T.active}
          </span>
        </div>
        <div className="num text-xs text-muted-foreground">
          {T.createdAt(formatDateTime(token.created_at))}
          {" · "}
          {token.last_used_at ? T.lastUsed(formatDateTime(token.last_used_at)) : T.neverUsed}
          {token.revoked_at ? (
            <>
              {" · "}
              {T.revokedAt(formatDateTime(token.revoked_at))}
            </>
          ) : null}
        </div>
      </div>
      {revoked ? null : (
        <Button
          variant="outline"
          size="sm"
          className="text-over hover:bg-over-soft hover:text-over"
          onClick={onRevoke}
          aria-label={T.revokeLabel(token.name)}
        >
          {T.revoke}
        </Button>
      )}
    </li>
  );
}

function TokensCard() {
  const queryClient = useQueryClient();
  const nameId = useId();
  const tokens = useQuery(tokensQuery);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [created, setCreated] = useState<Schemas["TokenCreatedOut"] | null>(null);
  const [revoking, setRevoking] = useState<Schemas["TokenOut"] | null>(null);

  const create = useMutation({
    mutationFn: createToken,
    // The response carries the token itself. `reset()` when the dialog closes detaches it
    // from this observer, and gcTime 0 drops it from the MutationCache right away, so no
    // copy outlives the dialog.
    gcTime: 0,
    onSuccess: (token) => {
      setCreated(token);
      setName("");
      void queryClient.invalidateQueries({ queryKey: keys.tokens });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: number) => revokeToken(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.tokens });
      setRevoking(null);
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    setNameError(trimmed ? undefined : S.common.nameRequired);
    if (trimmed) create.mutate({ name: trimmed });
  }

  let list: React.ReactNode;
  if (tokens.isLoadingError) {
    list = (
      <ErrorState
        className="rounded-none border-0 border-t shadow-none"
        title={S.errors.loadFailedTitle}
        error={tokens.error}
        onRetry={() => void tokens.refetch()}
      />
    );
  } else if (!tokens.data) {
    list = (
      <div role="status" aria-label={S.common.loading} className="space-y-2 border-t p-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  } else if (tokens.data.length === 0) {
    list = <p className="border-t px-4 py-6 text-center text-muted-foreground sm:px-5">{T.empty}</p>;
  } else {
    list = (
      <ul>
        {activeFirst(tokens.data).map((token) => (
          <TokenRow key={token.id} token={token} onRevoke={() => setRevoking(token)} />
        ))}
      </ul>
    );
  }

  return (
    <SectionCard title={T.title} description={T.description}>
      <form onSubmit={submit} noValidate className="border-t px-4 py-4 sm:px-5">
        <Label htmlFor={nameId} className="mb-1.5">
          {T.name}
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={T.namePlaceholder}
            maxLength={100}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? T.creating : T.create}
          </Button>
        </div>
        {nameError ? (
          <p id={`${nameId}-error`} className="mt-1.5 text-xs text-over">
            {nameError}
          </p>
        ) : null}
        {create.isError ? (
          <div className="mt-3">
            <FormError message={errorMessage(create.error)} />
          </div>
        ) : null}
      </form>
      {list}
      {created ? (
        <CreatedTokenDialog
          token={created}
          onClose={() => {
            setCreated(null);
            create.reset();
          }}
        />
      ) : null}
      {revoking ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setRevoking(null);
              revoke.reset();
            }
          }}
          title={T.revokeDialog.title(revoking.name)}
          description={T.revokeDialog.body}
          confirmLabel={T.revokeDialog.confirm}
          pendingLabel={T.revokeDialog.revoking}
          pending={revoke.isPending}
          error={revoke.isError ? errorMessage(revoke.error) : null}
          onConfirm={() => revoke.mutate(revoking.id)}
        />
      ) : null}
    </SectionCard>
  );
}

/** Everything an agent needs: where to connect, which channels, and its token. */
export function AgentSection({ channels }: { channels: readonly Schemas["ChannelOut"][] }) {
  return (
    <div className="space-y-5">
      <TokensCard />
      <ConnectionCard channels={channels} />
    </div>
  );
}
