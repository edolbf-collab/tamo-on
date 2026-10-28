/* Calendário compartilhado pela edição e exclusão de horários — Parte 22AK. */
(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateValue = value => new Date(value + 'T12:00:00');
  const iso = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  const monthLabel = value => dateValue(value + '-01').toLocaleDateString('pt-BR', {month:'long',year:'numeric'});

  function markup(field) {
    const id = 'schedule-calendar-' + field.name;
    return '<section class="field full schedule-calendar" data-field-name="' + escape(field.name) + '">' +
      '<strong>' + escape(field.label) + '</strong>' +
      '<div class="schedule-calendar-summary"><button type="button" class="button ghost small" data-calendar-toggle aria-expanded="false" aria-controls="' + id + '">Selecionar datas</button>' +
      '<span data-calendar-count role="status" aria-live="polite">Nenhuma data adicional selecionada</span></div>' +
      '<div id="' + id + '" class="schedule-calendar-panel" hidden>' +
      '<div class="schedule-calendar-navigation"><button type="button" class="button ghost small" data-calendar-prev aria-label="Mês anterior">‹</button>' +
      '<strong data-calendar-month aria-live="polite"></strong><button type="button" class="button ghost small" data-calendar-next aria-label="Próximo mês">›</button></div>' +
      '<div class="schedule-calendar-weekdays" aria-hidden="true">' + ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(day => '<span>' + day + '</span>').join('') + '</div>' +
      '<div class="schedule-calendar-days" role="group" aria-label="Datas para seleção"></div>' +
      '<div class="schedule-calendar-actions"><button type="button" class="button ghost small" data-calendar-all>Selecionar todas disponíveis</button><button type="button" class="button ghost small" data-calendar-clear>Limpar seleção</button></div>' +
      '<small class="field-help" data-calendar-range></small><small class="field-help">✓ Selecionada · ○ Origem · × Protegida. Dias apagados não possuem este horário disponível.</small></div>' +
      '<small class="field-help">' + escape(field.help || '') + '</small>' +
      '<div hidden data-calendar-inputs>' + (field.options || []).map(option => '<input type="checkbox" data-calendar-input name="' + escape(option.value) + '" value="true" data-date="' + escape(option.date) + '"' + (option.disabled ? ' disabled' : '') + '>').join('') + '</div>' +
      '<small class="field-error" role="alert" hidden></small></section>';
  }

  function mount(root, field) {
    const source = field.sourceDate;
    const options = new Map((field.options || []).map(option => [option.date, option]));
    const inputs = new Map([...root.querySelectorAll('[data-calendar-input]')].map(input => [input.dataset.date,input]));
    const firstMonth = source.slice(0,7);
    const lastMonth = [...options.keys(),source].sort().at(-1).slice(0,7);
    let month = firstMonth;
    const panel = root.querySelector('.schedule-calendar-panel');
    const toggle = root.querySelector('[data-calendar-toggle]');
    const days = root.querySelector('.schedule-calendar-days');
    const count = root.querySelector('[data-calendar-count]');
    const all = root.querySelector('[data-calendar-all]');
    const clear = root.querySelector('[data-calendar-clear]');
    const available = [...inputs.values()].filter(input => !input.disabled);
    root.querySelector('[data-calendar-range]').textContent = firstMonth === lastMonth
      ? 'Seleção limitada a ' + monthLabel(firstMonth) + '.'
      : 'Selecionar todas inclui as datas disponíveis de ' + monthLabel(firstMonth) + ' a ' + monthLabel(lastMonth) + '.';

    function render() {
      const selected = available.filter(input => input.checked).length;
      count.textContent = selected ? selected + (selected === 1 ? ' data adicional selecionada' : ' datas adicionais selecionadas') : 'Nenhuma data adicional selecionada';
      root.querySelector('[data-calendar-month]').textContent = monthLabel(month);
      root.querySelector('[data-calendar-prev]').disabled = month <= firstMonth;
      root.querySelector('[data-calendar-next]').disabled = month >= lastMonth;
      all.disabled = !available.length || selected === available.length;
      clear.disabled = !selected;
      days.setAttribute('aria-label','Datas de ' + monthLabel(month));
      const start = dateValue(month + '-01');
      const length = new Date(start.getFullYear(),start.getMonth()+1,0,12).getDate();
      let html = '<span aria-hidden="true"></span>'.repeat(start.getDay());
      for (let day=1;day<=length;day++) {
        const date = iso(new Date(start.getFullYear(),start.getMonth(),day,12));
        const option = options.get(date), input = inputs.get(date);
        const origin = date === source;
        const enabled = Boolean(input && !input.disabled);
        const selected = Boolean(enabled && input.checked);
        const status = origin ? 'Horário de origem, já incluído' : option?.disabled ? option.reason || 'Horário protegido' : !enabled ? 'Sem horário equivalente disponível' : selected ? 'Selecionada' : 'Disponível para seleção';
        const label = dateValue(date).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) + ' — ' + status;
        html += '<button type="button" class="schedule-calendar-day' + (origin?' is-origin':'') + (option?.disabled?' is-protected':'') + '" data-calendar-day="' + date + '" aria-label="' + escape(label) + '" title="' + escape(label) + '" aria-pressed="' + selected + '"' + (!enabled?' disabled':'') + '><span>' + day + '</span><small aria-hidden="true">' + (selected?'✓':origin?'○':option?.disabled?'×':'') + '</small></button>';
      }
      days.innerHTML = html;
    }
    function changed(focusDate) {
      render();
      if (focusDate) root.querySelector('[data-calendar-day="' + focusDate + '"]')?.focus({preventScroll:true});
      root.dispatchEvent(new Event('change',{bubbles:true}));
    }
    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button === toggle) {
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded',String(!panel.hidden));
        toggle.textContent = panel.hidden ? 'Selecionar datas' : 'Fechar calendário';
      } else if (button.hasAttribute('data-calendar-prev') || button.hasAttribute('data-calendar-next')) {
        const date = dateValue(month + '-01');
        date.setMonth(date.getMonth() + (button.hasAttribute('data-calendar-prev') ? -1 : 1));
        month = iso(date).slice(0,7); render();
      } else if (button === all || button === clear) {
        available.forEach(input => {input.checked = button === all;}); changed();
      } else if (button.dataset.calendarDay) {
        const input = inputs.get(button.dataset.calendarDay);
        if (input && !input.disabled) { input.checked = !input.checked; changed(button.dataset.calendarDay); }
      }
    });
    render();
  }
  window.ScheduleDateCalendar = Object.freeze({markup,mount});
})();
