// ============================================================
//  Color Game - game.js
//  CSS 3D 骰子（无 PixiJS），支持可控概率
// ========================================================

// -------------- 游戏配置 --------------
const COLORS = [
    { name: 'yellow', label: '黄色', hex: '#f5d836' },
    { name: 'white',  label: '白色', hex: '#f5f0e8' },
    { name: 'pink',   label: '粉色', hex: '#ff4d9e' },
    { name: 'blue',   label: '蓝色', hex: '#2080ff' },
    { name: 'orange', label: '橙色', hex: '#ff7010' },
    { name: 'green',  label: '绿色', hex: '#30e070' }
];

let _betAmount = 10;    // 每次点击的筹码价值
let _betQuantity = 'inf' // 投注数量：'inf'=∞(1份)、10、100
let balance = 1000;
let bets = [0, 0, 0, 0, 0, 0];
let isRolling = false;
let _cleanupTimer = null; // finishRoll 的延迟清理定时器，防止与下次 rollDice 冲突

// 三个骰子的6面色顺序（各不相同）
const DICE_FACES = [
    [0, 1, 2, 3, 4, 5], // dice0: 颜色→面 直接对应
    [1, 0, 3, 2, 5, 4], // dice1
    [2, 3, 4, 5, 0, 1], // dice2
];

// 面索引 → 骰子停止时需要旋转到的角度（deg），使该面朝前（朝向相机）
const FACE_TARGET_ANGLES = [
    { rx:   0, ry:   0 }, // 0=front  → 不转
    { rx:   0, ry: 180 }, // 1=back   → Y 转180°
    { rx:   0, ry: -90 }, // 2=right  → Y 转-90°
    { rx:   0, ry:  90 }, // 3=left   → Y 转90°
    { rx:  90, ry:   0 }, // 4=top    → X 转90°
    { rx: -90, ry:   0 }, // 5=bottom → X 转-90°
];

// ============================================================
//  随机概率控制模块
//  代码位置：【BEGIN】随机概率控制 —— 【END】随机概率控制
// ============================================================

/**
 * 【随机概率控制 - 核心逻辑】
 *
 * 修改概率的方式（在浏览器控制台或外部 JS 调用）：
 *
 * 1. 加权随机（让某颜色更容易中奖）：
 *    setDiceProbability({ mode: 'weighted', weights: [2,1,1,1,1,1] });
 *    // 权重：[黄,白,粉,蓝,橙,绿]，默认全为1（均匀）
 *
 * 2. 强制指定结果（测试用）：
 *    setDiceProbability({ mode: 'force', results: [0,0,0] });
 *    // 三个骰子结果强制为 黄色,黄色,黄色
 *
 * 3. 恢复默认（均匀随机）：
 *    setDiceProbability({ mode: 'default' });
 *
 * 4. 高级：完全自定义随机函数
 *    window.customDiceRandom = function() {
 *        // 返回如 [0,2,4] 的数组
 *    };
 */

let _diceProbConfig = { mode: 'default' };

function setDiceProbability(config) {
    _diceProbConfig = config;
}

function weightedRandom(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

function rollDiceRandom() {
    const cfg = _diceProbConfig;
    // 模式1：强制指定结果
    if (cfg.mode === 'force') {
        return [...cfg.results];
    }
    // 模式2：加权随机
    if (cfg.mode === 'weighted' && cfg.weights) {
        return [
            weightedRandom(cfg.weights),
            weightedRandom(cfg.weights),
            weightedRandom(cfg.weights),
        ];
    }
    // 模式3：自定义函数（外部提供）
    if (typeof window.customDiceRandom === 'function') {
        return window.customDiceRandom();
    }
    // 默认：均匀随机
    return [
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
        Math.floor(Math.random() * 6),
    ];
}

// 【END】随机概率控制

// ============================================================
//  CSS 3D 骰子类
// ============================================================

const DICE_SIZE = 21; // 骰子边长 px（缩小一半）

class Dice3D {
    /**
     * @param {HTMLElement} container - 骰子容器（.dice-container）
     * @param {{x:number, y:number}} pos - 骰子初始位置（相对于 machine-wrapper）
     * @param {number} diceIdx - 骰子编号 0/1/2
     */
    constructor(container, pos, diceIdx) {
        this.diceIdx = diceIdx;
        this.size = DICE_SIZE;
        this.phase = 'idle'; // idle | rolling | done
        this.animFrameId = null;

        // 当前旋转角度（deg）
        this.rx = 0;
        this.ry = 0;

        // 目标角度（停止时）
        this.targetRx = 0;
        this.targetRy = 0;  // 大写Y，与 setTarget() 保持一致

        // 创建 DOM 结构
        this.el = this._createDOM(pos);
        container.appendChild(this.el);

        this._render();
    }

    /** 创建骰子 DOM（6 个面 + 阴影） */
    _createDOM(pos) {
        const wrapper = document.createElement('div');
        wrapper.className = 'dice-scene';
        wrapper.style.position = 'absolute';
        wrapper.style.left     = pos.x + 'px';
        wrapper.style.top      = pos.y + 'px';
        wrapper.style.width    = this.size + 'px';
        wrapper.style.height   = this.size + 'px';
        wrapper.style.perspective = '600px';

        // 3D 旋转容器
        const dice = document.createElement('div');
        dice.className = 'dice-3d';
        dice.style.width  = this.size + 'px';
        dice.style.height = this.size + 'px';
        dice.style.position = 'relative';
        dice.style.transformStyle = 'preserve-3d';
        dice.style.transform = 'rotateX(0deg) rotateY(0deg)';

        // 6 个面
        const faceNames = ['front', 'back', 'right', 'left', 'top', 'bottom'];
        const faceOrder = DICE_FACES[this.diceIdx]; // 这个骰子每个面对应哪个颜色
        this._faceEls = [];

        for (let i = 0; i < 6; i++) {
            const colorIdx = faceOrder[i];
            const color = COLORS[colorIdx];
            const face = document.createElement('div');
            face.className = 'dice-face ' + faceNames[i];
            face.style.position = 'absolute';
            face.style.width  = this.size + 'px';
            face.style.height = this.size + 'px';
            face.style.borderRadius = '6px';
            face.style.border = '1.5px solid rgba(255,255,255,0.25)';
            face.style.display = 'flex';
            face.style.alignItems = 'center';
            face.style.justifyContent = 'center';
            face.style.fontSize = '10px';
            face.style.fontWeight = 'bold';
            face.style.color = 'rgba(0,0,0,0.45)';
            face.style.backgroundColor = color.hex;
            face.style.backfaceVisibility = 'hidden';
            face.style.boxShadow = 'inset 0 0 8px rgba(0,0,0,0.15)';
            dice.appendChild(face);
            this._faceEls[i] = face;
        }

        wrapper.appendChild(dice);
        this._diceEl = dice;

        // 阴影
        const shadow = document.createElement('div');
        shadow.className = 'dice-shadow';
        shadow.style.position = 'absolute';
        shadow.style.left   = (this.size / 2 - this.size * 0.38) + 'px';
        shadow.style.top    = (this.size + this.size * 0.6 - this.size * 0.08) + 'px';
        shadow.style.width  = (this.size * 0.75) + 'px';
        shadow.style.height = (this.size * 0.16) + 'px';
        shadow.style.background = 'rgba(0,0,0,0.18)';
        shadow.style.borderRadius = '50%';
        shadow.style.pointerEvents = 'none';
        shadow.style.opacity = '0';
        wrapper.appendChild(shadow);
        this._shadowEl = shadow;

        return wrapper;
    }

    /** 设置目标结果（哪个颜色朝上/朝前） */
    setTarget(colorIdx) {
        const faceOrder = DICE_FACES[this.diceIdx];
        const faceIdx = faceOrder.indexOf(colorIdx); // 找出该颜色在哪个面上
        const angles = FACE_TARGET_ANGLES[faceIdx];
        // 多加几圈旋转，让动画更自然
        this.targetRx = angles.rx + 360 * (3 + Math.floor(Math.random() * 3));
        this.targetRy = angles.ry + 360 * (2 + Math.floor(Math.random() * 3));
        this._resultColorIdx = colorIdx;
    }

    /** 更新 DOM transform（ immediate，无 transition） */
    _render() {
        this._diceEl.style.transition = 'none';
        this._diceEl.style.transform =
            'rotateX(' + this.rx.toFixed(1) + 'deg) rotateY(' + this.ry.toFixed(1) + 'deg)';
    }

    /** 销毁 */
    destroy() {
        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
        if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
        this.el = null;
    }
}

// ============================================================
//  动画控制器
// ============================================================

let activeDice = []; // 当前活动的 3 个 Dice3D 实例
let _animFrameId = null;

function startRollAnimation(results) {
    // 取消之前的动画循环，防止多个动画互相干扰导致骰子消失
    if (_animFrameId) {
        cancelAnimationFrame(_animFrameId);
        _animFrameId = null;
    }

    // 取消残留的清理定时器，防止误销毁新骰子
    if (_cleanupTimer) {
        clearTimeout(_cleanupTimer);
        _cleanupTimer = null;
    }

    const container = document.getElementById('diceContainer');

    // 三个骰子的初始位置（相对于 machine-wrapper 314×499）
    const dicePositions = [
        { x: 58,  y: 175 },
        { x: 136, y: 175 },
        { x: 214, y: 175 },
    ];
    const endY = 370; // 停止时的 Y 位置

    const t0 = performance.now();

    // 创建骰子实例
    activeDice = results.map((colorIdx, i) => {
        const d = new Dice3D(container, dicePositions[i], i);
        d.setTarget(colorIdx);
        d._endY   = endY;
        d._startY = dicePositions[i].y;
        d._phase  = 'waiting';
        d._delay  = i * 250;       // 错开启动
        d._duration = 2200 + i * 300; // 总时长 ms
        return d;
    });

    function tick() {
        const now = performance.now();
        let allDone = true;

        for (let i = 0; i < activeDice.length; i++) {
            const d = activeDice[i];
            if (d._phase === 'done') continue;
            allDone = false;

            const diceStartTime = t0 + d._delay;
            if (now < diceStartTime) continue;

            if (d._phase === 'waiting') {
                d._phase = 'rolling';
                d._tStart = now;
            }

            const elapsed  = now - d._tStart;
            const progress = Math.min(elapsed / d._duration, 1);

            if (progress < 0.75) {
                // 阶段1：快速旋转 + 下落
                const p = progress / 0.75;
                const spinFactor = 1 - p * 0.65;

                d.rx += (0.2 + Math.sin(p * 10) * 0.05) * spinFactor * 360 / 60;
                d.ry += (0.16 + Math.cos(p * 8) * 0.04) * spinFactor * 360 / 60;

                // 下落
                const yEase = p * p;
                const currentY = d._startY + (d._endY - d._startY) * yEase;
                d.el.style.top = currentY + 'px';

                // 阴影
                d._shadowEl.style.opacity = Math.min(p * 2.5, 0.55).toString();

                d._render();

            } else {
                // 阶段2：减速对齐到目标角度
                const alignP = (progress - 0.75) / 0.25;
                const ease = 1 - Math.pow(1 - alignP, 3);

                d.rx = lerpAngleDeg(d.rx, d.targetRx, ease * 0.15);
                d.ry = lerpAngleDeg(d.ry, d.targetRy, ease * 0.15);

                d.el.style.top = d._endY + 'px';
                d._shadowEl.style.opacity = '0.55';

                // 弹跳效果
                if (alignP < 0.65) {
                    const bounce = -5 * Math.sin(alignP / 0.65 * Math.PI);
                    d.el.style.top = (d._endY + bounce) + 'px';
                }

                d._render();
            }

            // 完成检测
            if (progress >= 1 && d._phase !== 'done') {
                d._phase = 'done';
                d.rx = d.targetRx % 360;
                d.ry = d.targetRy % 360;
                d._render();
            }
        }

        // forEach 结束后，统一判断是否继续动画
        if (!allDone) {
            _animFrameId = requestAnimationFrame(tick);
        } else {
            _animFrameId = null;
            // 所有骰子停止后，多等 1200ms 让弹跳收尾，再出结果
            setTimeout(() => finishRoll(results), 1200);
        }
    }

    _animFrameId = requestAnimationFrame(tick);
}

/** 角度最短路径插值（deg） */
function lerpAngleDeg(a, b, t) {
    let diff = b - a;
    while (diff > 180)  diff -= 360;
    while (diff < -180) diff += 360;
    return a + diff * t;
}

// ============================================================
//  投注控制（金额 + 投注数量）
// ============================================================

/** 更新金额显示 */
function updateBetAmountDisplay() {
    const display = document.getElementById('betAmountDisplay');
    if (display) display.textContent = _betAmount;
}

/** 设置投注金额 */
function setBetAmount(val) {
    _betAmount = val;
    updateBetAmountDisplay();
    // 高亮选中的快捷按钮
    document.querySelectorAll('.quick-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.amt) === val);
    });
}

/** 调整投注金额（1/2、2×、+1、-1） */
function adjustBetAmount(factor) {
    let newVal;
    if (factor === 0.5) {
        newVal = Math.max(1, Math.round(_betAmount / 2));
    } else if (factor === 2) {
        newVal = _betAmount * 2;
    } else {
        newVal = Math.max(1, _betAmount + factor);
    }
    setBetAmount(newVal);
}

/** 设置投注数量（∞、10、100） */
function setBetQuantity(val) {
    _betQuantity = val;
    document.querySelectorAll('.qty-btn').forEach(b => {
        b.classList.toggle('active', (b.dataset.qty === 'inf' && val === 'inf') || b.dataset.qty == val);
    });
}

// ============================================================
//  游戏逻辑
// ============================================================

function addBet(btn) {
    if (isRolling) return;
    const idx = parseInt(btn.dataset.index);
    const qty = _betQuantity === 'inf' ? 1 : _betQuantity;
    const cost = qty * _betAmount;
    if (balance < cost) {
        showHint('余额不足！', 'lose');
        return;
    }
    bets[idx] += qty;
    balance -= cost;
    updateUI();
    btn.style.transform = 'scale(0.95)';
    setTimeout(() => btn.style.transform = '', 100);
}

function clearAllBets() {
    if (isRolling) return;
    if (bets.every(b => b === 0)) return;
    const total = bets.reduce((a, b) => a + b, 0) * _betAmount;
    balance += total;
    bets = [0, 0, 0, 0, 0, 0];
    updateUI();
    showHint('已清除所有下注', '');
}

function updateUI() {
    const total = bets.reduce((a, b) => a + b, 0) * _betAmount;
    document.getElementById('balanceDisplay').textContent = balance.toFixed(2);
    document.getElementById('totalBet').textContent = total;

    for (let i = 0; i < 6; i++) {
        const chipStack = document.getElementById('chips-' + i);
        const label     = document.getElementById('label-' + i);
        const btn      = document.querySelector('.color-btn[data-index="' + i + '"]');
        chipStack.innerHTML = '';
        if (bets[i] > 0) {
            const showCount = Math.min(bets[i], 8);
            for (let c = 0; c < showCount; c++) {
                const chip = document.createElement('div');
                chip.className = 'chip';
                if (c === showCount - 1 && bets[i] > 1) {
                    chip.textContent = bets[i];
                    chip.style.fontSize = bets[i] >= 10 ? '9px' : '10px';
                }
                chipStack.appendChild(chip);
            }
            label.textContent = (bets[i] * _betAmount).toFixed(2);
            label.classList.add('show');
            btn.style.borderColor = 'rgba(255,255,255,0.6)';
        } else {
            label.classList.remove('show');
            btn.style.borderColor = 'transparent';
        }
    }

    const hasBet = bets.some(b => b > 0);
    document.getElementById('rollBtn').disabled = !hasBet || isRolling;
}

function showHint(text, type) {
    const hint = document.getElementById('hintText');
    hint.textContent = text;
    hint.className = 'hint-text' + (type ? ' ' + type : '');
}

// -------------- 摇骰子 --------------

function rollDice() {
    if (isRolling) return;
    const total = bets.reduce((a, b) => a + b, 0) * _betAmount;
    if (total === 0) return;

    isRolling = true;
    document.getElementById('rollBtn').disabled = true;
    document.getElementById('clearBtn').disabled = true;
    document.querySelectorAll('.color-btn').forEach(b => b.disabled = true);
    document.querySelectorAll('.payout-check').forEach(c => c.classList.remove('checked'));

    // ========== 随机概率调用位置 ==========
    // 这里调用 rollDiceRandom()，行为由 setDiceProbability() 控制
    // 详见上方【随机概率控制】代码区域
    const results = rollDiceRandom();
    // ================================================

    showHint('摇骰中...', '');
    document.getElementById('resultBar').textContent = '...';
    document.getElementById('resultBar').className = 'result-bar';

    // 取消上次的延迟清理定时器（防止误清除新骰子）
    if (_cleanupTimer) {
        clearTimeout(_cleanupTimer);
        _cleanupTimer = null;
    }

    // 清除旧骰子
    if (activeDice.length) {
        activeDice.forEach(d => d.destroy());
        activeDice = [];
    }
    document.getElementById('diceContainer').innerHTML = '';

    startRollAnimation(results);
}

// -------------- 结算 --------------

function finishRoll(results) {
    isRolling = false;
    document.getElementById('rollBtn').disabled = false;
    document.getElementById('clearBtn').disabled = false;
    document.querySelectorAll('.color-btn').forEach(b => b.disabled = false);

    const resultBar = document.getElementById('resultBar');
    let totalWin = 0;
    let winMessages = [];

    for (let ci = 0; ci < 6; ci++) {
        if (bets[ci] === 0) continue;
        const mc  = results.filter(r => r === ci).length;
        const bet = bets[ci] * _betAmount;
        let win = 0;
        if (mc === 1)      win = bet * 2;
        else if (mc === 2) win = bet * 3;
        else if (mc === 3) win = Math.floor(bet * 16.7);
        if (win > 0) {
            totalWin += win;
            const mult = mc === 1 ? 2 : mc === 2 ? 3 : 16.7;
            winMessages.push(COLORS[ci].label + '中' + mc + '个 x' + mult);
        }
    }

    let maxMatch = 0;
    for (let ci = 0; ci < 6; ci++) {
        if (bets[ci] === 0) continue;
        maxMatch = Math.max(maxMatch, results.filter(r => r === ci).length);
    }
    if (maxMatch >= 1) document.getElementById('check1').classList.add('checked');
    if (maxMatch >= 2) document.getElementById('check2').classList.add('checked');
    if (maxMatch >= 3) document.getElementById('check3').classList.add('checked');

    const resultColors = results.map(r => COLORS[r].label).join('、');

    if (totalWin > 0) {
        balance += totalWin;
        resultBar.textContent = '🎉 ' + winMessages.join('，') + ' 共获得 ' + totalWin;
        resultBar.className = 'result-bar win';
        showHint('恭喜！赢得 ' + totalWin + ' 金币！', 'win');
        spawnCoins();
    } else {
        resultBar.textContent = '结果：' + resultColors + '，未命中';
        resultBar.className = 'result-bar lose';
        showHint('很遗憾，再试一次吧', 'lose');
    }

    updateUI();
    bets = [0, 0, 0, 0, 0, 0];
    updateUI();
    // updateUI 在 bets 清零后会禁用按钮，但结算后用户需要重新下注，按钮必须可用
    document.getElementById('rollBtn').disabled = false;

    // 延迟清理骰子（保存 ID 以便下次 rollDice 时取消，防止误清除新骰子）
    _cleanupTimer = setTimeout(() => {
        activeDice.forEach(d => d.destroy());
        activeDice = [];
        document.getElementById('diceContainer').innerHTML = '';
        _cleanupTimer = null;
    }, 3000);
}

// -------------- 金币雨 --------------

function spawnCoins() {
    for (let i = 0; i < 18; i++) {
        setTimeout(() => {
            const coin = document.createElement('div');
            coin.className = 'coin';
            coin.textContent = ['💰','🪙','💎','✨'][Math.floor(Math.random() * 4)];
            coin.style.left = (Math.random() * window.innerWidth) + 'px';
            coin.style.top  = (Math.random() * 120 + 80) + 'px';
            coin.style.fontSize = (18 + Math.random() * 12) + 'px';
            document.body.appendChild(coin);
            setTimeout(() => coin.remove(), 1400);
        }, i * 70);
    }
}

// -------------- 初始化 --------------
updateUI();
