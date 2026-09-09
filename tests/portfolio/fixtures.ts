import type { BrowserContext } from "@playwright/test";
export async function installFixture(
  context: BrowserContext,
  { theme = "dark", empty = false, completed = false } = {},
) {
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "portfolio@example.test",
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { full_name: "Pessoa de demonstração" },
    app_metadata: { provider: "email" },
    created_at: "2026-09-01T12:00:00Z",
  };
  const session = {
    access_token: "local-fixture-token",
    refresh_token: "local-fixture-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  await context.addInitScript(
    ({ session, theme }) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      localStorage.setItem("kb_theme", theme);
    },
    { session, theme },
  );
  const tracks = empty
    ? []
    : ["Estudos", "Portfólio"].map((name, i) => ({
        id: `area-${i}`,
        name,
        bg: "#f0f0f0",
        fg: "#222222",
        border: "#727272",
        dark_bg: "#202020",
        dark_fg: "#ededed",
        order: i,
      }));
  const columns = ["todo", "inprogress", "done"].map((id, i) => ({
    id,
    name: ["A Fazer", "Em Andamento", "Concluído"][i],
    order: i,
    track_id: null,
  }));
  const tasks: Record<string, unknown>[] = empty
    ? []
    : [
        {
          id: "task-1",
          title: "Preparar demonstração do projeto",
          desc: "Dados fictícios para revisão visual.",
          type: "Task",
          col: "todo",
          track: "area-0",
          tags: [],
          prio: "Média",
          order: 0,
          created_at: "2026-09-09T12:00:00Z",
          updated_at: "2026-09-09T12:00:00Z",
        },
      ];
  if (completed)
    tasks.push({
      ...tasks[0],
      id: "done-1",
      col: "done",
      title: "Concluído de demonstração",
      updated_at: new Date().toISOString(),
      done_at: new Date().toISOString(),
    });
  const tables: Record<string, unknown> = {
    tracks,
    columns,
    tasks,
    trilhas: [],
    user_profile: { user_id: user.id, onboarding_completed: true, theme },
  };
  const writes: { table: string; method: string }[] = [];
  await context.route("http://127.0.0.1:4199/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let data;
    if (url.pathname.startsWith("/auth/")) data = user;
    else if (url.pathname.includes("/rpc/")) {
      const body = req.postDataJSON();
      writes.push({ table: url.pathname.split("/").pop()!, method: req.method() });
      if (url.pathname.endsWith("reorder_areas")) {
        const ordered = body.ordered_ids as string[];
        for (const row of tracks) row.order = ordered.indexOf(row.id);
        tracks.sort((a, b) => a.order - b.order);
        data = tracks;
      } else if (url.pathname.endsWith("archive_done_area")) {
        data = tasks.filter((row) => body.expected_ids.includes(row.id));
        for (const row of data as Record<string, unknown>[]) {
          row.manual_archived_at = new Date().toISOString();
          row.archive_snoozed_until = null;
        }
      } else {
        data = tasks.filter((row) => body.task_ids.includes(row.id));
        for (const row of data as Record<string, unknown>[]) {
          row.manual_archived_at = null;
          row.archive_snoozed_until = new Date(Date.now() + 7 * 86400000).toISOString();
        }
      }
    } else {
      const name = url.pathname.split("/")[3];
      if (req.method() === "GET") data = tables[name] ?? [];
      else {
        const body = req.postDataJSON();
        writes.push({ table: name, method: req.method() });
        if (name === "tasks" && req.method() === "POST") {
          const row = { ...body, id: body.id ?? `task-${tasks.length + 1}` };
          tasks.push(row);
          data = row;
        } else if (name === "tasks" && req.method() === "PATCH") {
          const id = url.searchParams.get("id")?.replace("eq.", "");
          Object.assign(tasks.find((x) => x.id === id) ?? {}, body);
          data = null;
        } else data = body;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  return { writes, tasks };
}
