(() => {
  const flash = document.querySelector('[data-dismiss-flash]');
  if (flash) {
    flash.addEventListener('click', () => flash.closest('.flash')?.remove());
    window.setTimeout(() => flash.closest('.flash')?.remove(), 5500);
  }

  const menuToggle = document.querySelector('[data-menu-toggle]');
  const mobileMenu = document.querySelector('[data-mobile-menu]');
  if (menuToggle && mobileMenu) {
    const closeMobileMenu = () => {
      mobileMenu.classList.remove('is-open');
      mobileMenu.setAttribute('aria-hidden', 'true');
      menuToggle.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    };

    menuToggle.addEventListener('click', () => {
      const opening = !mobileMenu.classList.contains('is-open');
      mobileMenu.classList.toggle('is-open', opening);
      mobileMenu.setAttribute('aria-hidden', String(!opening));
      menuToggle.classList.toggle('is-open', opening);
      menuToggle.setAttribute('aria-expanded', String(opening));
      document.body.style.overflow = opening ? 'hidden' : '';
    });

    mobileMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu));
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMobileMenu(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 830) closeMobileMenu(); });
  }

  document.querySelectorAll('.newsletter-form').forEach((form) => {
    form.addEventListener('submit', () => {
      const input = form.querySelector('input[type="email"]');
      if (!input?.value) return;
      const original = form.innerHTML;
      form.innerHTML = '<span style="padding:10px 0;color:#b282dc;font-size:12px">PRÓXIMO DROP: VOCÊ ESTÁ NA LISTA.</span>';
      window.setTimeout(() => { form.innerHTML = original; }, 3500);
    });
  });

  document.querySelectorAll('[data-sales-chart]').forEach((chart) => {
    let series = [];
    try { series = JSON.parse(chart.dataset.salesChart || '[]'); } catch (_) { series = []; }
    const bars = chart.querySelector('.chart-bars');
    const labels = chart.querySelector('.chart-labels');
    if (!bars || !labels) return;
    const values = series.length ? series : Array.from({ length: 7 }, (_, index) => ({ day: `D${index + 1}`, total: 0 }));
    const max = Math.max(...values.map((item) => Number(item.total) || 0), 1);
    values.slice(-14).forEach((item) => {
      const bar = document.createElement('span');
      bar.className = 'chart-bar';
      const height = Math.max(4, Math.round(((Number(item.total) || 0) / max) * 100));
      bar.style.height = `${height}%`;
      const formatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(item.total) || 0) / 100);
      bar.dataset.value = formatted;
      bars.appendChild(bar);
      const label = document.createElement('span');
      label.textContent = String(item.day).slice(5).replace('-', '/');
      labels.appendChild(label);
    });
  });
})();

(() => {
  const onlyDigits = (value) => String(value || '').replace(/\D/g, '');
  const formatCep = (value) => {
    const digits = onlyDigits(value).slice(0, 8);
    return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
  };
  const formatCurrency = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);

  document.querySelectorAll('[data-address-form]').forEach((form) => {
    const cepInput = form.querySelector('[data-cep]');
    if (!cepInput) return;
    const status = form.querySelector('[data-cep-status]');
    const street = form.querySelector('[data-address-street]');
    const district = form.querySelector('[data-address-district]');
    const city = form.querySelector('[data-address-city]');
    const state = form.querySelector('[data-address-state]');
    const checkout = form.matches('[data-checkout-form]');

    const setStatus = (text, type = '') => {
      if (!status) return;
      status.textContent = text;
      status.dataset.state = type;
    };

    const updateShipping = async (cep) => {
      if (!checkout || cep.length !== 8) return;
      const subtotal = Number(form.dataset.subtotal || 0);
      try {
        const response = await fetch(`/api/frete?cep=${encodeURIComponent(cep)}&subtotal=${encodeURIComponent(subtotal)}`, { headers: { Accept: 'application/json' } });
        const quote = await response.json();
        if (!response.ok || !quote.ok) return;
        const label = document.querySelector('[data-shipping-label]');
        const value = document.querySelector('[data-shipping-value]');
        const total = document.querySelector('[data-order-total]');
        const note = document.querySelector('[data-freight-note]');
        if (label) label.textContent = quote.label;
        if (value) value.textContent = quote.cents ? quote.formatted : (quote.isEstimated ? 'A confirmar' : 'GRÁTIS');
        if (total) total.textContent = formatCurrency(subtotal + (Number(quote.cents) || 0));
        if (note) note.textContent = quote.isEstimated ? 'A modalidade e o valor serão confirmados pela NEBLK após o pedido.' : 'Frete aplicado conforme a política atual da loja.';
      } catch (_) {
        // A compra continua disponível; o servidor sempre recalcula o frete ao confirmar o pedido.
      }
    };

    const lookupCep = async () => {
      const cep = onlyDigits(cepInput.value);
      cepInput.value = formatCep(cep);
      if (cep.length !== 8) {
        setStatus('Informe 8 dígitos.', 'error');
        return;
      }
      setStatus('Buscando endereço…', 'loading');
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { headers: { Accept: 'application/json' } });
        const data = await response.json();
        if (!response.ok || data.erro) throw new Error('CEP não encontrado');
        if (street && data.logradouro) street.value = data.logradouro;
        if (district && data.bairro) district.value = data.bairro;
        if (city && data.localidade) city.value = data.localidade;
        if (state && data.uf) state.value = data.uf;
        setStatus('Endereço encontrado.', 'success');
        await updateShipping(cep);
        form.querySelector('[name="address_number"]')?.focus();
      } catch (_) {
        setStatus('CEP não encontrado. Preencha manualmente.', 'error');
        await updateShipping(cep);
      }
    };

    cepInput.addEventListener('input', () => { cepInput.value = formatCep(cepInput.value); });
    cepInput.addEventListener('blur', lookupCep);
    if (onlyDigits(cepInput.value).length === 8 && checkout) updateShipping(onlyDigits(cepInput.value));
  });
})();
