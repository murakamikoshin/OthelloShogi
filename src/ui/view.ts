/**
 * DOM の組み立てと描画。ここはゲームのルールを一切知らない。
 * 与えられた ViewModel をそのまま画面に写すだけ。
 */
import { BOARD_SIZE, type Square } from '../core/index.ts';
import { PIECE_KANJI } from './labels.ts';

/** 1マスの表示内容。 */
export interface CellView {
  readonly piece: Square;
  /** 選択中の駒 */
  readonly selected: boolean;
  /** 移動できる／打てるマス */
  readonly target: boolean;
  /** プレビュー: 何段目で裏返るか（1始まり）。裏返らないなら null */
  readonly flipLevel: number | null;
  /** ここに打つと何枚裏返るか。0 or null なら出さない */
  readonly gain: number | null;
  /** 直前のアニメーションで裏返ったばかりか */
  readonly justFlipped: boolean;
  /** 直前の着手マスか */
  readonly last: boolean;
}

export interface HandChipView {
  readonly piece: 'P' | 'R' | 'B';
  readonly count: number;
  readonly selected: boolean;
  readonly enabled: boolean;
}

export interface ViewModel {
  readonly cells: readonly CellView[];
  readonly hands: Readonly<Record<'sente' | 'gote', readonly HandChipView[]>>;
  readonly turnLabel: string;
  readonly turnColor: 'sente' | 'gote';
  readonly hint: string;
  readonly confirmLabel: string | null;
  readonly canUndo: boolean;
  readonly canPass: boolean;
  readonly canResign: boolean;
  readonly animateLabel: string;
}

export interface ViewHandlers {
  onCell(row: number, col: number): void;
  onHand(owner: 'sente' | 'gote', piece: 'P' | 'R' | 'B'): void;
  onConfirm(): void;
  onUndo(): void;
  onPass(): void;
  onResign(): void;
  onToggleAnimate(): void;
  onRematch(): void;
}

const HAND_ORDER: readonly ('P' | 'R' | 'B')[] = ['P', 'R', 'B'];

export class View {
  private readonly cells: HTMLButtonElement[] = [];
  private readonly handSlots: Record<'sente' | 'gote', HTMLDivElement>;
  private readonly statusTurn: HTMLSpanElement;
  private readonly statusHint: HTMLSpanElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly passButton: HTMLButtonElement;
  private readonly resignButton: HTMLButtonElement;
  private readonly animateButton: HTMLButtonElement;
  private readonly chainBanner: HTMLDivElement;
  private readonly overlay: HTMLDivElement;

  constructor(root: HTMLElement, private readonly handlers: ViewHandlers) {
    root.innerHTML = `
      <header class="topbar">
        <h1>寝返り将棋<span class="subtitle">NEGAERI SHOGI</span></h1>
        <button class="ghost" data-role="animate"></button>
      </header>
      <section class="hand hand--gote">
        <span class="hand__label">後手<br />持ち駒</span>
        <div class="hand__pieces" data-role="hand-gote"></div>
      </section>
      <div class="board-wrap">
        <div class="board" data-role="board"></div>
      </div>
      <section class="hand hand--sente">
        <span class="hand__label">先手<br />持ち駒</span>
        <div class="hand__pieces" data-role="hand-sente"></div>
      </section>
      <p class="status">
        <span class="status__turn" data-role="turn"></span>
        <span class="status__hint" data-role="hint"></span>
        <button class="confirm" data-role="confirm" hidden></button>
      </p>
      <div class="actions">
        <button data-role="undo">待った</button>
        <button data-role="pass">パス</button>
        <button class="danger" data-role="resign">投了</button>
      </div>
      <div class="chain-banner" data-role="chain" hidden></div>
      <div class="overlay" data-role="overlay" hidden>
        <div class="overlay__card">
          <p class="overlay__title" data-role="result-title"></p>
          <p class="overlay__reason" data-role="result-reason"></p>
          <p class="overlay__stats" data-role="result-stats"></p>
          <button data-role="rematch">もう一局</button>
        </div>
      </div>
    `;

    const board = this.query<HTMLDivElement>(root, 'board');
    board.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 1fr)`;
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const cell = document.createElement('button');
        cell.className = 'cell';
        cell.type = 'button';
        cell.addEventListener('click', () => this.handlers.onCell(row, col));
        board.append(cell);
        this.cells.push(cell);
      }
    }

    this.handSlots = {
      sente: this.query<HTMLDivElement>(root, 'hand-sente'),
      gote: this.query<HTMLDivElement>(root, 'hand-gote'),
    };
    this.statusTurn = this.query<HTMLSpanElement>(root, 'turn');
    this.statusHint = this.query<HTMLSpanElement>(root, 'hint');
    this.confirmButton = this.query<HTMLButtonElement>(root, 'confirm');
    this.undoButton = this.query<HTMLButtonElement>(root, 'undo');
    this.passButton = this.query<HTMLButtonElement>(root, 'pass');
    this.resignButton = this.query<HTMLButtonElement>(root, 'resign');
    this.animateButton = this.query<HTMLButtonElement>(root, 'animate');
    this.chainBanner = this.query<HTMLDivElement>(root, 'chain');
    this.overlay = this.query<HTMLDivElement>(root, 'overlay');

    this.confirmButton.addEventListener('click', () => this.handlers.onConfirm());
    this.undoButton.addEventListener('click', () => this.handlers.onUndo());
    this.passButton.addEventListener('click', () => this.handlers.onPass());
    this.resignButton.addEventListener('click', () => this.handlers.onResign());
    this.animateButton.addEventListener('click', () => this.handlers.onToggleAnimate());
    this.query<HTMLButtonElement>(root, 'rematch').addEventListener('click', () =>
      this.handlers.onRematch(),
    );
  }

  private query<T extends HTMLElement>(root: HTMLElement, role: string): T {
    const element = root.querySelector<T>(`[data-role="${role}"]`);
    if (!element) throw new Error(`テンプレートに [data-role="${role}"] がありません`);
    return element;
  }

  render(model: ViewModel): void {
    model.cells.forEach((cellView, index) => {
      const cell = this.cells[index];
      if (!cell) return;
      this.renderCell(cell, cellView);
    });

    for (const owner of ['sente', 'gote'] as const) {
      this.renderHand(this.handSlots[owner], owner, model.hands[owner]);
    }

    this.statusTurn.textContent = model.turnLabel;
    this.statusTurn.dataset.turn = model.turnColor;
    this.statusHint.textContent = model.hint;

    this.confirmButton.hidden = model.confirmLabel === null;
    if (model.confirmLabel !== null) this.confirmButton.textContent = model.confirmLabel;

    this.undoButton.disabled = !model.canUndo;
    this.passButton.disabled = !model.canPass;
    this.resignButton.disabled = !model.canResign;
    this.animateButton.textContent = model.animateLabel;
  }

  private renderCell(cell: HTMLButtonElement, view: CellView): void {
    const { piece } = view;
    const existing = cell.firstElementChild as HTMLElement | null;

    if (!piece) {
      if (existing) existing.remove();
    } else {
      const tile = existing ?? document.createElement('span');
      if (!existing) {
        tile.className = 'cell__piece';
        cell.append(tile);
      }
      const kanji = PIECE_KANJI[piece.type];
      if (tile.textContent !== kanji) tile.textContent = kanji;
      tile.dataset.owner = piece.owner;
      tile.dataset.promoted = String(piece.type.startsWith('+'));
    }

    this.toggleAttr(cell, 'data-selected', view.selected ? 'true' : null);
    this.toggleAttr(cell, 'data-target', view.target ? 'true' : null);
    this.toggleAttr(cell, 'data-occupied', view.target && piece ? 'true' : null);
    this.toggleAttr(cell, 'data-flip', view.flipLevel === null ? null : String(view.flipLevel));
    this.toggleAttr(cell, 'data-gain', view.gain ? `+${view.gain}` : null);
    this.toggleAttr(cell, 'data-just-flipped', view.justFlipped ? 'true' : null);
    this.toggleAttr(cell, 'data-last', view.last ? 'true' : null);
  }

  private toggleAttr(element: HTMLElement, name: string, value: string | null): void {
    if (value === null) element.removeAttribute(name);
    else if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  private renderHand(
    slot: HTMLDivElement,
    owner: 'sente' | 'gote',
    chips: readonly HandChipView[],
  ): void {
    const visible = chips.filter((chip) => chip.count > 0);
    if (visible.length === 0) {
      slot.innerHTML = '<span class="hand__empty">なし</span>';
      return;
    }

    slot.replaceChildren(
      ...HAND_ORDER.flatMap((piece) => {
        const chip = visible.find((candidate) => candidate.piece === piece);
        if (!chip) return [];
        const button = document.createElement('button');
        button.className = 'chip';
        button.type = 'button';
        button.disabled = !chip.enabled;
        button.setAttribute('aria-pressed', String(chip.selected));
        button.innerHTML =
          `<span class="chip__kanji">${PIECE_KANJI[piece]}</span>` +
          `<span class="chip__count">${chip.count}</span>`;
        button.addEventListener('click', () => this.handlers.onHand(owner, piece));
        return [button];
      }),
    );
  }

  /** 3連鎖以上のときだけ出す演出。 */
  showChainBanner(chainCount: number): void {
    this.chainBanner.innerHTML = `<span>${chainCount} 連鎖!</span>`;
    this.chainBanner.hidden = false;
    window.setTimeout(() => {
      this.chainBanner.hidden = true;
    }, 700);
  }

  showResult(title: string, reason: string, stats: string): void {
    this.overlay.querySelector('[data-role="result-title"]')!.textContent = title;
    this.overlay.querySelector('[data-role="result-reason"]')!.textContent = reason;
    this.overlay.querySelector('[data-role="result-stats"]')!.textContent = stats;
    this.overlay.hidden = false;
  }

  hideResult(): void {
    this.overlay.hidden = true;
  }
}
