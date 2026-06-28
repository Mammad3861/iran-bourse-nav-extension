import { calculateNav } from '../core/nav-calculator';
import { formatNumberFa, formatPercentRatioFa } from '../core/number-utils';
import { formatPersianTimestamp } from '../core/persian-date-utils';
import { getActiveSymbol, getManualOverride } from '../data/cache-store';
import '../ui/styles.css';

function setText(selector: string, value: string): void {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

async function renderPopup(): Promise<void> {
  const symbol = await getActiveSymbol();
  setText('[data-popup-symbol]', symbol ?? 'نماد نامشخص');

  if (!symbol) {
    document.querySelector<HTMLElement>('[data-popup-empty]')!.hidden = false;
    return;
  }

  const record = await getManualOverride(symbol);
  if (!record) {
    document.querySelector<HTMLElement>('[data-popup-empty]')!.hidden = false;
    return;
  }

  const result = calculateNav(record.inputs);
  setText('[data-popup-result="navTotal"]', formatNumberFa(result.navTotal));
  setText('[data-popup-result="navPerShare"]', formatNumberFa(result.navPerShare, 2));
  setText('[data-popup-result="pToNav"]', formatPercentRatioFa(result.pToNav));
  setText('[data-popup-result="updatedAt"]', formatPersianTimestamp(new Date(record.updatedAt)));
}

void renderPopup();
