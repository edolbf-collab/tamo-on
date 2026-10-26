/* Tâmo On Build 162 — denúncia e bloqueio pessoal. */
(() => {
  "use strict";
  const app = window.App;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reasons = { harassment: "Assédio ou intimidação", hate: "Discriminação ou discurso de ódio", sexual: "Conteúdo sexual inadequado", violence: "Ameaça ou violência", fraud: "Fraude ou spam", privacy: "Exposição de dados pessoais", other: "Outro motivo" };
  const statuses = { open: "Recebida", reviewing: "Em análise", resolved: "Concluída", dismissed: "Encerrada sem medida" };
  const types = { player: "Participante", announcement: "Aviso", match: "Evento", group: "Grupo", notification: "Notificação" };
  const date = value => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const on = (root, selector, fn) => root.querySelectorAll(selector).forEach(button => button.addEventListener("click", async event => {
    event.preventDefault();
    button.disabled = true;
    try { await fn(button, event); } catch (error) { app.toast(error.message || "Não foi possível concluir. Tente novamente.", true); }
    finally { button.disabled = false; }
  }));
  const rpc = async (name, params) => {
    const { data, error } = await app.repo.client.rpc(name, params);
    if (error) throw error;
    return data;
  };
  const back = '<button type="button" class="btn btn-secondary btn-small" data-safety-back>‹ Voltar</button>';
  const reportButton = (type, id, label = "Denunciar") => `<button type="button" class="safety-link" data-safety-report="${esc(type)}" data-id="${esc(id)}">${esc(label)}</button>`;

  Object.assign(app, {
    isUserBlocked(userId) { return (this.state.safety?.blocks || []).some(item => item.user_id === userId); },
    safetyReportButton: reportButton,
    bindSafetyReports(root, returnTo) {
      on(root, "[data-safety-report]", button => this.openSafetyReport(button.dataset.safetyReport, button.dataset.id, returnTo));
    },
    openMemberSafety(userId) {
      const member = this.state.members.find(item => item.user_id === userId);
      if (!member || userId === this.state.profile?.id) return;
      const player = this.memberPlayer(member);
      if (!player) return;
      const blocked = this.isUserBlocked(userId);
      const canManage = this.canManageMatches() && !["admin", "owner"].includes(member.role);
      this.modal(player.name, `<div class="safety-stack">${canManage ? '<button class="btn btn-secondary" data-safety-manage>Gerenciar membro</button>' : ""}<button class="btn btn-secondary" data-safety-denounce>Denunciar participante</button><button class="btn btn-secondary" data-safety-block>${blocked ? "Desbloquear" : "Bloquear"} participante</button><p class="safety-help">O bloqueio é pessoal e vale nos grupos em comum. Não remove a pessoa do grupo nem altera presenças, times ou caixa.</p></div>`, root => {
        on(root, "[data-safety-manage]", () => this.openMemberManager(userId));
        on(root, "[data-safety-denounce]", () => this.openSafetyReport("player", player.id, () => this.openMemberSafety(userId)));
        on(root, "[data-safety-block]", () => this.openSafetyBlock(userId, player.name, !blocked, () => this.openMemberSafety(userId)));
      });
    },
    openSafetyBlock(userId, name, blocked, returnTo = () => this.openSafetyCenter("blocks")) {
      this.modal(blocked ? "Bloquear participante" : "Desbloquear participante", `${back}<p><strong>${esc(name)}</strong></p><p class="safety-help">${blocked
        ? "Vocês deixarão de receber avisos e notificações um do outro e não poderão fazer novas avaliações entre si. Os dados necessários a presenças, times e caixa continuam visíveis. Comunicados gerais do Tâmo On continuam chegando."
        : "Se não houver outro bloqueio entre vocês, os avisos voltarão a aparecer e novas notificações e avaliações serão permitidas. Notificações que não foram entregues durante o bloqueio não serão reenviadas."}</p><p class="safety-help">Esta ação não remove nem suspende a conta.</p><button class="btn btn-primary btn-block" data-safety-confirm>${blocked ? "Confirmar bloqueio" : "Confirmar desbloqueio"}</button>`, root => {
        on(root, "[data-safety-back]", returnTo);
        on(root, "[data-safety-confirm]", async () => {
          await rpc("community_set_user_block", { p_user_id: userId, p_blocked: blocked });
          await this.repo.loadSafetyState();
          if (this.state.currentGroupId) await this.repo.loadGroup(this.state.currentGroupId, { subscribe: false });
          else await this.repo.loadUserNotifications();
          this.state = this.repo.state;
          this.render();
          this.toast(blocked ? "Participante bloqueado para você." : "Seu bloqueio foi removido.");
          await returnTo();
        });
      });
    },
    openSafetyReport(type, id, returnTo = () => this.openSafetyCenter()) {
      this.modal(`Denunciar ${String(types[type] || "conteúdo").toLowerCase()}`, `${back}<p class="safety-help">O relato será analisado pela administração do Tâmo On. Sua identidade não é exibida à pessoa denunciada nem aos administradores do grupo.</p><form id="safetyReportForm" class="form-grid"><div class="field"><label for="safetyReason">Motivo</label><select id="safetyReason" name="reason" required><option value="">Selecione</option>${Object.entries(reasons).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></div><div class="field"><label for="safetyDetails">O que aconteceu?</label><textarea id="safetyDetails" name="details" rows="4" minlength="10" maxlength="2000" required placeholder="Descreva o ocorrido. Evite incluir dados pessoais desnecessários."></textarea></div><p class="safety-help">Uma cópia do conteúdo denunciado será guardada para análise. Você poderá acompanhar a resposta em Segurança e convivência.</p><p class="safety-error" role="alert" hidden></p><button class="btn btn-primary btn-block" type="submit">Enviar denúncia</button></form>`, root => {
        on(root, "[data-safety-back]", returnTo);
        const form = root.querySelector("form");
        form.addEventListener("submit", async event => {
          event.preventDefault();
          if (!form.reportValidity()) return;
          const button = form.querySelector('[type="submit"]');
          if (button.disabled) return;
          const errorBox = form.querySelector('[role="alert"]');
          button.disabled = true; errorBox.hidden = true;
          try {
            const values = new FormData(form);
            const protocol = await rpc("community_report", { p_type: type, p_id: id, p_reason: values.get("reason"), p_details: String(values.get("details") || "").trim() });
            this.modal("Denúncia recebida", `<p>Protocolo <strong>${esc(protocol)}</strong></p><p class="safety-help">O relato está registrado para análise. O envio da denúncia não suspende automaticamente o participante.</p><button class="btn btn-primary btn-block" data-safety-track>Acompanhar denúncias</button><button class="btn btn-secondary btn-block" data-safety-back>Voltar</button>`, nextRoot => {
              on(nextRoot, "[data-safety-track]", () => this.openSafetyCenter());
              on(nextRoot, "[data-safety-back]", returnTo);
            });
          } catch (error) { errorBox.textContent = error.message || "Não foi possível enviar. Seu relato foi mantido nesta tela."; errorBox.hidden = false; }
          finally { button.disabled = false; }
        });
      });
    },
    async openSafetyCenter(tab = "reports", offset = 0) {
      if (tab === "admin" && !this.state.is_platform_admin) return;
      let loading;
      this.modal("Segurança e convivência", '<p class="safety-help" role="status">Carregando…</p>', root => { loading = root.querySelector('[role="status"]'); });
      try {
        const [safety, reports] = await Promise.all([
          this.repo.loadSafetyState(),
          tab === "blocks" ? Promise.resolve([]) : rpc("community_reports", { p_admin: tab === "admin", p_offset: offset })
        ]);
        if (!loading.isConnected) return;
        const tabs = `<div class="safety-tabs" aria-label="Segurança"><button class="btn btn-small ${tab === "reports" ? "btn-primary" : "btn-secondary"}" data-safety-tab="reports">Minhas denúncias</button><button class="btn btn-small ${tab === "blocks" ? "btn-primary" : "btn-secondary"}" data-safety-tab="blocks">Bloqueados</button>${this.state.is_platform_admin ? `<button class="btn btn-small ${tab === "admin" ? "btn-primary" : "btn-secondary"}" data-safety-tab="admin">Moderação (${Number(safety.pending_reports || 0)})</button>` : ""}</div>`;
        const list = tab === "blocks" ? (safety.blocks || []).map(item => `<article class="card safety-row"><strong>${esc(item.name)}</strong><button class="btn btn-secondary btn-small" data-safety-unblock="${esc(item.user_id)}">Desbloquear</button></article>`).join("")
          : (reports || []).map(item => `<article class="card safety-report"><div class="safety-row"><strong>${esc(types[item.target_type])} · ${esc(statuses[item.status])}</strong><small>${esc(date(item.created_at))}</small></div><p><strong>${esc(item.target_label || types[item.target_type])}</strong></p><small>Protocolo ${esc(item.id.slice(0,8))} · ${esc(reasons[item.reason])}</small><p>${esc(item.details)}</p>${item.response ? `<p class="safety-response"><strong>Resposta:</strong> ${esc(item.response)}</p>` : ""}${tab === "admin" ? `<button class="btn btn-secondary btn-small" data-safety-review="${esc(item.id)}">Analisar denúncia</button>` : ""}</article>`).join("");
        this.modal("Segurança e convivência", `${tabs}<div class="safety-stack">${list || `<p class="safety-help">${tab === "blocks" ? "Você não bloqueou participantes." : "Nenhuma denúncia nesta página."}</p>`}</div>${tab !== "blocks" ? `<div class="safety-pagination">${offset > 0 ? '<button class="btn btn-secondary btn-small" data-safety-prev>Anterior</button>' : ""}${reports.length === 30 ? '<button class="btn btn-secondary btn-small" data-safety-next>Próxima</button>' : ""}</div>` : ""}${tab === "reports" ? `<details class="safety-new"><summary>Denunciar outro conteúdo</summary><div class="safety-stack">${this.currentGroup() ? reportButton("group", this.state.currentGroupId, "Denunciar este grupo") : ""}${this.state.players.some(player => player.user_id !== this.state.profile.id) ? '<button class="btn btn-secondary btn-small" data-safety-player>Denunciar participante ou convidado</button>' : ""}<p class="safety-help">Para denunciar uma pessoa, abra Membros e toque no nome. Avisos e eventos também têm a opção Denunciar.</p>${(this.state.user_notifications || []).length ? '<button class="btn btn-secondary btn-small" data-safety-notification>Denunciar uma notificação</button>' : ""}</div></details>` : ""}`, root => {
          on(root, "[data-safety-tab]", button => this.openSafetyCenter(button.dataset.safetyTab));
          on(root, "[data-safety-prev]", () => this.openSafetyCenter(tab, Math.max(0, offset - 30)));
          on(root, "[data-safety-next]", () => this.openSafetyCenter(tab, offset + 30));
          on(root, "[data-safety-unblock]", button => {
            const item = safety.blocks.find(row => row.user_id === button.dataset.safetyUnblock);
            this.openSafetyBlock(item.user_id, item.name, false);
          });
          on(root, "[data-safety-review]", button => this.openSafetyReview(reports.find(item => item.id === button.dataset.safetyReview), offset));
          on(root, "[data-safety-player]", () => this.openPlayerReportPicker());
          on(root, "[data-safety-notification]", () => this.openNotificationReportPicker());
          this.bindSafetyReports(root, () => this.openSafetyCenter(tab, offset));
        });
      } catch (error) {
        if (!loading.isConnected) return;
        loading.textContent = error.message || "Não foi possível carregar. Feche e tente novamente.";
        loading.setAttribute("role", "alert");
      }
    },
    openPlayerReportPicker() {
      const players = this.state.players.filter(item => item.user_id !== this.state.profile.id).sort((a,b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
      this.modal("Denunciar participante", `${back}<div class="field"><label for="safetyPlayer">Selecione a pessoa</label><select id="safetyPlayer">${players.map(item => `<option value="${esc(item.id)}">${esc(item.name)}${item.user_id ? "" : " · convidado"}</option>`).join("")}</select></div><button class="btn btn-primary btn-block" data-safety-choose>Continuar</button>`, root => {
        on(root, "[data-safety-back]", () => this.openSafetyCenter());
        on(root, "[data-safety-choose]", () => this.openSafetyReport("player", root.querySelector("select").value, () => this.openPlayerReportPicker()));
      });
    },
    openNotificationReportPicker() {
      this.modal("Denunciar notificação", `${back}<div class="field"><label for="safetyNotification">Selecione a mensagem</label><select id="safetyNotification">${(this.state.user_notifications || []).map(item => `<option value="${esc(item.id)}">${esc(date(item.created_at))} · ${esc(item.title)}</option>`).join("")}</select></div><button class="btn btn-primary btn-block" data-safety-choose>Continuar</button>`, root => {
        on(root, "[data-safety-back]", () => this.openSafetyCenter());
        on(root, "[data-safety-choose]", () => this.openSafetyReport("notification", root.querySelector("select").value, () => this.openNotificationReportPicker()));
      });
    },
    openSafetyReview(report, offset) {
      const hideAllowed = report.target_type === "announcement" || (report.target_type === "notification" && ["announcement", "announcement-resend"].includes(report.snapshot?.notification_type));
      this.modal("Analisar denúncia", `${back}<p><strong>${esc(reasons[report.reason])}</strong></p><p class="safety-help">${esc(report.details)}</p><details class="safety-evidence"><summary>Conteúdo registrado na denúncia</summary><pre>${esc(JSON.stringify(report.snapshot, null, 2))}</pre></details>${report.actions?.length ? `<details class="safety-evidence"><summary>Histórico da análise</summary>${report.actions.map(item => `<p>${esc(date(item.created_at))} · ${esc(item.action)}<br>${esc(item.response)}</p>`).join("")}</details>` : ""}<form class="form-grid" id="safetyReviewForm"><div class="field"><label for="safetyStatus">Andamento</label><select id="safetyStatus" name="status">${["reviewing", "resolved", "dismissed"].map(key => `<option value="${key}" ${report.status === key ? "selected" : ""}>${statuses[key]}</option>`).join("")}</select></div><div class="field"><label for="safetyMeasure">Medida</label><select id="safetyMeasure" name="action"><option value="none">Somente registrar análise / resposta</option>${hideAllowed ? '<option value="hide_announcement">Retirar aviso da exibição</option><option value="restore_announcement">Restaurar exibição do aviso</option>' : ""}${report.target_user_id && report.target_user_id !== this.state.profile.id ? '<option value="suspend_account">Suspender acesso da conta</option>' : ""}</select></div><div class="field"><label for="safetyResponse">Resposta para quem denunciou</label><textarea id="safetyResponse" name="response" rows="4" minlength="10" maxlength="2000" required>${esc(report.response)}</textarea></div><p class="safety-help">A resposta será visível a quem enviou o relato. Não inclua dados de terceiros. Para aplicar uma medida, escolha Concluída.</p><p role="alert" class="safety-error" hidden></p><button class="btn btn-primary btn-block" type="submit">Salvar análise</button></form>`, root => {
        on(root, "[data-safety-back]", () => this.openSafetyCenter("admin", offset));
        const form = root.querySelector("form");
        form.addEventListener("submit", async event => {
          event.preventDefault();
          if (!form.reportValidity()) return;
          const button = form.querySelector('[type="submit"]');
          if (button.disabled) return;
          const values = new FormData(form), action = values.get("action");
          if (action !== "none" && !confirm(action === "suspend_account" ? "Suspender o acesso desta conta ao Tâmo On? Os registros do grupo serão preservados." : action === "restore_announcement" ? "Restaurar a exibição deste aviso para o grupo?" : "Retirar este aviso da exibição para todos? A evidência da denúncia será preservada.")) return;
          button.disabled = true;
          const errorBox = form.querySelector('[role="alert"]'); errorBox.hidden = true;
          try {
            await rpc("community_review_report", { p_id: report.id, p_version: report.version, p_status: values.get("status"), p_response: String(values.get("response") || "").trim(), p_action: action });
            if (this.state.currentGroupId) await this.repo.loadGroup(this.state.currentGroupId, { subscribe: false });
            this.state = this.repo.state; this.render();
            this.toast("Análise registrada."); await this.openSafetyCenter("admin", offset);
          } catch (error) { errorBox.textContent = error.message || "Não foi possível salvar a análise."; errorBox.hidden = false; }
          finally { button.disabled = false; }
        });
      });
    }
  });
})();
