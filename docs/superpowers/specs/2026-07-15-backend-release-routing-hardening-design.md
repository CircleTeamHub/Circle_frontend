# Backend Release Routing Hardening Design

## Goal

Ensure a blue-green standby cannot receive production traffic before it passes
its Docker health gate, while preserving automatic rollback and strict public
smoke checks.

## Target

Implement in `circle_be` on a branch based on `origin/ci/auto-release`
(`a18f0f0`). Do not mix application feature changes into the release branch.

## Routing Decision

Remove the shared `circle-be-app` and compatibility `circle_be` aliases from
the application service definitions. Docker Compose already provides stable,
distinct service DNS names:

- blue: `circle_be:3000`
- green: `circle_be_green:3000`

Caddy lists both names as explicit upstreams. Configure:

- `lb_policy first` so blue is preferred while healthy and green is used when
  blue is absent or unhealthy;
- active checks against `/api/v1/auth/me` with expected HTTP 401;
- a short health interval and timeout;
- passive failure memory with 5xx marked unhealthy;
- bounded retry duration for connection failures.

Because a missing or starting color fails active health, it is excluded until
the known route returns the expected unauthenticated response. On a green
release, blue remains preferred until the script stops it. On the next blue
release, traffic may move to blue as soon as it is healthy, which is safe and
still precedes removal of the old green container.

## Caddy Configuration Activation

Repository sync changes the bind-mounted Caddyfile but does not activate it in
an already-running Caddy container. Add a release-script function that:

1. requires Caddy to be running;
2. validates `/etc/caddy/Caddyfile` inside the container;
3. reloads that exact file with the Caddyfile adapter;
4. fails the release before database migration or standby startup if validation
   or reload fails.

This makes the distinct-upstream configuration effective on existing servers
before a standby is created. Bootstrap deployments continue loading the same
file when Caddy first starts.

## Deployment Sequence

The release order becomes:

1. acquire the release lock and pull the immutable image;
2. identify live and standby colors;
3. validate and reload Caddy routing;
4. back up the database and run migration;
5. create the standby on its own service DNS name;
6. wait for Docker health;
7. stop the old color;
8. require the strict public smoke response;
9. remove the old color only after smoke succeeds.

On startup or smoke failure, remove the standby and restore the old container
using the existing rollback path. Caddy continues to select only a healthy,
resolvable color.

## Testing

Extend the release hardening tests to prove:

1. neither Compose file assigns the same application alias to both colors;
2. Caddy names `circle_be:3000` and `circle_be_green:3000` explicitly;
3. active health checks use the known auth route and expected 401 status;
4. passive health rejects 5xx and retry duration remains bounded;
5. the release script validates and reloads Caddy before migration and
   `compose up` of the standby;
6. shell syntax, Compose rendering, Caddy adaptation, workflow YAML, and the
   existing release contract suite pass.

If a local Caddy binary is unavailable, validate the Caddyfile with the pinned
Docker image without starting application services.

## Non-Goals

- Replacing Caddy or Docker Compose.
- Adding a service-discovery control plane.
- Changing image promotion, SSH, database backup, or admin-web rollback logic.
- Retrying non-idempotent requests after a successful upstream connection.
