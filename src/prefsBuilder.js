import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {
    MAX_ADOPTED_PETS,
    SPECIES_PRESETS,
    CLASS_ARCHETYPES,
    createNewPetRecord,
    buildAiPetPrompt,
    xpRequiredForLevel,
    getArchetype,
} from './rpg.js';
import { UpdateChecker, RELEASES_PAGE_URL } from './updateChecker.js';

const ARCHETYPE_LIST = Object.values(CLASS_ARCHETYPES);

function readRosterState(settings) {
    try {
        const raw = settings.get_string('roster-json');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.pets) && parsed.pets.length > 0) {
                const pets = parsed.pets.slice(0, MAX_ADOPTED_PETS).map(p => createNewPetRecord(p));
                let primaryPetId = parsed.primaryPetId || pets[0].id;
                if (!pets.some(p => p.id === primaryPetId))
                    primaryPetId = pets[0].id;
                return { primaryPetId, pets };
            }
        }
    } catch (_e) {
        // Ignore parse error
    }
    const starter = createNewPetRecord({ name: '团子', presetId: 'cat', archetype: 'martial' });
    return { primaryPetId: starter.id, pets: [starter] };
}

function writeRosterState(settings, state) {
    settings.set_string('roster-json', JSON.stringify(state));
}

function copyTextToClipboard(text) {
    const display = Gdk.Display.get_default();
    if (!display)
        return false;
    const clipboard = display.get_clipboard();
    clipboard.set(text);
    return true;
}

function openImageFileDialog(window, title, onSelected) {
    const dialog = new Gtk.FileDialog({ title });
    const filter = new Gtk.FileFilter();
    filter.set_name('图片 / GIF / 精灵图 (PNG, GIF, WebP)');
    for (const m of ['image/png', 'image/gif', 'image/webp', 'image/jpeg'])
        filter.add_mime_type(m);
    const filters = Gio.ListStore.new(Gtk.FileFilter.$gtype);
    filters.append(filter);
    dialog.set_filters(filters);

    dialog.open(window, null, (dlg, res) => {
        try {
            const file = dlg.open_finish(res);
            const path = file?.get_path?.();
            if (path)
                onSelected(path);
        } catch (_e) {
            // Cancelled
        }
    });
}

function createSpinRow({ title, subtitle, settings, key, min, max, step = 1, digits = 0 }) {
    const adjustment = new Gtk.Adjustment({
        lower: min,
        upper: max,
        step_increment: step,
        page_increment: step * 5,
        value: digits > 0 ? settings.get_double(key) : settings.get_int(key),
    });
    const row = new Adw.SpinRow({ title, subtitle: subtitle || '', adjustment, digits });
    row.connect('notify::value', () => {
        const val = row.get_value();
        if (digits > 0)
            settings.set_double(key, val);
        else
            settings.set_int(key, Math.round(val));
    });
    return row;
}

function createSwitchRow({ title, subtitle, settings, key }) {
    const row = new Adw.SwitchRow({ title, subtitle: subtitle || '' });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function populatePreferencesWindow(window, settings, extensionPath = '') {
    window.set_default_size(740, 760);
    window.set_search_enabled(true);

    // =========================================================================
    // TAB 1: 🐾 宠物小队管理与领养 / 放生 (最多 3 只)
    // =========================================================================
    const pageSquad = new Adw.PreferencesPage({
        title: '宠物小队与领养',
        icon_name: 'emblem-favorite-symbolic',
    });

    let rosterGroup = null;
    let adoptGroup = null;

    const adoptDraft = {
        name: '新伙伴',
        archetypeIdx: 1, // fire
        skinModeIdx: 0,  // 0: preset, 1: spritesheet (AI 10x4), 2: gif
        presetIdx: 4,    // dragon
        customPath: '',
        cols: 4,
        rows: 10,
        autoRemoveBg: true,
    };

    const rebuildSquadPage = () => {
        if (rosterGroup)
            pageSquad.remove(rosterGroup);
        if (adoptGroup)
            pageSquad.remove(adoptGroup);

        const state = readRosterState(settings);

        rosterGroup = new Adw.PreferencesGroup({
            title: `我的已领养宠物 (${state.pets.length} / ${MAX_ADOPTED_PETS})`,
            description: '最多可同时领养 3 只宠物！所有出战宠物会在顶部栏自由散步、与系统图标互动耍宝、与同伴击掌/跳山羊/切磋；标有 👑 的主战宠物将代表你参加局域网同屏与擂台决斗。',
        });

        state.pets.forEach((pet, idx) => {
            const isPrimary = pet.id === state.primaryPetId;
            const arch = getArchetype(pet.archetype);
            const nextXp = xpRequiredForLevel(pet.level);

            const expRow = new Adw.ExpanderRow({
                title: `${isPrimary ? '👑 ' : '🐾 '}${pet.name}  ·  Lv.${pet.level}  [${arch.badge}]`,
                subtitle: `经验 ${pet.xp}/${nextXp}  ·  战绩 ${pet.wins}胜 ${pet.losses}负  ·  ${pet.skinMode === 'preset' ? '内置高清像素模型' : '自定义素材'}`,
                expanded: idx === 0 && state.pets.length === 1,
            });

            // 1. Rename
            const nameEntry = new Adw.EntryRow({
                title: '宠物名字',
                text: pet.name,
            });
            nameEntry.connect('apply', () => {
                const st = readRosterState(settings);
                const target = st.pets.find(p => p.id === pet.id);
                if (target) {
                    target.name = nameEntry.get_text().trim() || pet.name;
                    writeRosterState(settings, st);
                    rebuildSquadPage();
                }
            });
            nameEntry.set_show_apply_button(true);
            expRow.add_row(nameEntry);

            // 2. Class Archetype Selector
            const archModel = Gtk.StringList.new(ARCHETYPE_LIST.map(a => `${a.badge} ${a.name} — ${a.desc.slice(0, 18)}…`));
            const archCombo = new Adw.ComboRow({
                title: '职业流派 (决定成长属性与等级解锁技能)',
                model: archModel,
            });
            const curArchIdx = Math.max(0, ARCHETYPE_LIST.findIndex(a => a.id === pet.archetype));
            archCombo.set_selected(curArchIdx);
            archCombo.connect('notify::selected', () => {
                const sel = ARCHETYPE_LIST[archCombo.get_selected()];
                if (!sel)
                    return;
                const st = readRosterState(settings);
                const target = st.pets.find(p => p.id === pet.id);
                if (target && target.archetype !== sel.id) {
                    target.archetype = sel.id;
                    writeRosterState(settings, st);
                    rebuildSquadPage();
                }
            });
            expRow.add_row(archCombo);

            // 3. Roam on Top Bar Switch
            const roamSwitch = new Adw.SwitchRow({
                title: '在顶部栏出战漫步',
                subtitle: isPrimary ? '主战宠物始终在顶部栏活跃' : '开启后与其它伙伴同屏互动（击掌、跳山羊、同步舞、过招等）',
                active: pet.onTopBar !== false,
                sensitive: !isPrimary,
            });
            roamSwitch.connect('notify::active', () => {
                const st = readRosterState(settings);
                const target = st.pets.find(p => p.id === pet.id);
                if (target) {
                    target.onTopBar = roamSwitch.get_active();
                    writeRosterState(settings, st);
                }
            });
            expRow.add_row(roamSwitch);

            // 4. Quick Skin Changer for this Pet
            const skinModel = Gtk.StringList.new([
                ...SPECIES_PRESETS.map(s => `内置 · ${s.label}`),
                '自定义 · AI 精灵图 (10行×4列 PNG)',
                '自定义 · GIF 动图',
            ]);
            const skinCombo = new Adw.ComboRow({
                title: '角色形象来源',
                subtitle: pet.customPath ? `当前文件: ${pet.customPath}` : '内置 12 态高清像素模型',
                model: skinModel,
            });
            let initSkinIdx = SPECIES_PRESETS.findIndex(s => s.id === pet.presetId);
            if (pet.skinMode === 'spritesheet')
                initSkinIdx = SPECIES_PRESETS.length;
            else if (pet.skinMode === 'gif')
                initSkinIdx = SPECIES_PRESETS.length + 1;
            skinCombo.set_selected(Math.max(0, initSkinIdx));

            skinCombo.connect('notify::selected', () => {
                const selIdx = skinCombo.get_selected();
                const st = readRosterState(settings);
                const target = st.pets.find(p => p.id === pet.id);
                if (!target)
                    return;

                if (selIdx < SPECIES_PRESETS.length) {
                    target.skinMode = 'preset';
                    target.presetId = SPECIES_PRESETS[selIdx].id;
                    writeRosterState(settings, st);
                    rebuildSquadPage();
                } else {
                    const chosenMode = selIdx === SPECIES_PRESETS.length ? 'spritesheet' : 'gif';
                    openImageFileDialog(window, '选择自定义宠物精灵图或 GIF', path => {
                        const st2 = readRosterState(settings);
                        const t2 = st2.pets.find(p => p.id === pet.id);
                        if (t2) {
                            t2.skinMode = chosenMode;
                            t2.customPath = path;
                            t2.cols = 4;
                            t2.rows = chosenMode === 'spritesheet' ? 10 : 1;
                            t2.autoRemoveBg = true;
                            writeRosterState(settings, st2);
                            rebuildSquadPage();
                        }
                    });
                }
            });
            expRow.add_row(skinCombo);

            // 5. Primary & Release Action Row
            const actionRow = new Adw.ActionRow({
                title: '小队调度与放生',
                subtitle: isPrimary ? '当前为主战代表宠物' : '可设为主战代表，或让它回归自然放生离开',
            });
            const btnBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 8,
                valign: Gtk.Align.CENTER,
            });

            if (!isPrimary) {
                const setMainBtn = new Gtk.Button({ label: '👑 设为主战' });
                setMainBtn.connect('clicked', () => {
                    const st = readRosterState(settings);
                    st.primaryPetId = pet.id;
                    const t = st.pets.find(p => p.id === pet.id);
                    if (t)
                        t.onTopBar = true;
                    writeRosterState(settings, st);
                    rebuildSquadPage();
                });
                btnBox.append(setMainBtn);
            }

            const releaseBtn = new Gtk.Button({
                label: '🍃 放生宠物',
                css_classes: ['destructive-action'],
            });
            releaseBtn.connect('clicked', () => {
                const alert = new Gtk.AlertDialog({
                    message: `确定要放生「${pet.name} (Lv.${pet.level})」吗？`,
                    detail: state.pets.length <= 1
                        ? `放生最后一只伙伴后，它的养成等级将被清空，并为你重新领养一只 Lv.1 初始幼宠。`
                        : `放生后「${pet.name}」将从宠物小队中永久离开，回归大自然。`,
                    buttons: ['取消', '确认放生 🍃'],
                    cancel_button: 0,
                    default_button: 0,
                });
                alert.choose(window, null, (dlg, res) => {
                    try {
                        const choice = dlg.choose_finish(res);
                        if (choice === 1) {
                            const st = readRosterState(settings);
                            st.pets = st.pets.filter(p => p.id !== pet.id);
                            if (st.pets.length === 0)
                                st.pets.push(createNewPetRecord({ name: '团子', presetId: 'cat', archetype: 'martial' }));
                            if (!st.pets.some(p => p.id === st.primaryPetId))
                                st.primaryPetId = st.pets[0].id;
                            writeRosterState(settings, st);
                            rebuildSquadPage();
                        }
                    } catch (_e) {
                        // Cancelled
                    }
                });
            });
            btnBox.append(releaseBtn);
            actionRow.add_suffix(btnBox);
            expRow.add_row(actionRow);

            rosterGroup.add(expRow);
        });

        pageSquad.add(rosterGroup);

        // Adopt New Pet Panel (when < 3 pets!)
        if (state.pets.length < MAX_ADOPTED_PETS) {
            adoptGroup = new Adw.PreferencesGroup({
                title: `➕ 领养新宠物 (还可领养 ${MAX_ADOPTED_PETS - state.pets.length} 只)`,
                description: '可领养内置 6 款萌宠，也可直接导入你在「✨ AI 提示词工坊」生成的自定义精灵图或 GIF！',
            });

            const newNameRow = new Adw.EntryRow({
                title: '新宠物昵称',
                text: adoptDraft.name,
            });
            newNameRow.connect('changed', () => {
                adoptDraft.name = newNameRow.get_text();
            });
            adoptGroup.add(newNameRow);

            const newArchCombo = new Adw.ComboRow({
                title: '选择职业流派',
                model: Gtk.StringList.new(ARCHETYPE_LIST.map(a => `${a.badge} ${a.name} (${a.desc.slice(0, 20)}…)`)),
            });
            newArchCombo.set_selected(adoptDraft.archetypeIdx);
            newArchCombo.connect('notify::selected', () => {
                adoptDraft.archetypeIdx = newArchCombo.get_selected();
            });
            adoptGroup.add(newArchCombo);

            const newModeCombo = new Adw.ComboRow({
                title: '外观类型',
                model: Gtk.StringList.new([
                    '内置高清像素角色 (6 款可选)',
                    'AI 生成 / 自定义精灵图 (自动去白底/绿幕抠图)',
                    '自定义 GIF 动图',
                ]),
            });
            newModeCombo.set_selected(adoptDraft.skinModeIdx);
            adoptGroup.add(newModeCombo);

            const newPresetCombo = new Adw.ComboRow({
                title: '内置角色选择',
                model: Gtk.StringList.new(SPECIES_PRESETS.map(s => s.label)),
                visible: adoptDraft.skinModeIdx === 0,
            });
            newPresetCombo.set_selected(adoptDraft.presetIdx);
            newPresetCombo.connect('notify::selected', () => {
                adoptDraft.presetIdx = newPresetCombo.get_selected();
                const sp = SPECIES_PRESETS[adoptDraft.presetIdx];
                if (sp && (!adoptDraft.name || adoptDraft.name === '新伙伴')) {
                    adoptDraft.name = sp.defaultName;
                    newNameRow.set_text(sp.defaultName);
                }
            });
            adoptGroup.add(newPresetCombo);

            const fileRow = new Adw.ActionRow({
                title: '自定义图片文件',
                subtitle: adoptDraft.customPath || '尚未选择文件（点击右侧按钮浏览 PNG / GIF）',
                visible: adoptDraft.skinModeIdx !== 0,
            });
            const pickBtn = new Gtk.Button({ label: '浏览文件…', valign: Gtk.Align.CENTER });
            pickBtn.connect('clicked', () => {
                openImageFileDialog(window, '选择自定义精灵图或 GIF', path => {
                    adoptDraft.customPath = path;
                    fileRow.set_subtitle(path);
                });
            });
            fileRow.add_suffix(pickBtn);
            adoptGroup.add(fileRow);

            const colsRow = new Adw.SpinRow({
                title: '精灵图每行帧数 (Columns)',
                adjustment: new Gtk.Adjustment({ lower: 1, upper: 32, step_increment: 1, value: adoptDraft.cols }),
                visible: adoptDraft.skinModeIdx === 1,
            });
            colsRow.connect('notify::value', () => { adoptDraft.cols = Math.round(colsRow.get_value()); });
            adoptGroup.add(colsRow);

            const rowsRow = new Adw.SpinRow({
                title: '精灵图总行数 (AI 提示词标准为 10 行)',
                adjustment: new Gtk.Adjustment({ lower: 1, upper: 32, step_increment: 1, value: adoptDraft.rows }),
                visible: adoptDraft.skinModeIdx === 1,
            });
            rowsRow.connect('notify::value', () => { adoptDraft.rows = Math.round(rowsRow.get_value()); });
            adoptGroup.add(rowsRow);

            const autoBgRow = new Adw.SwitchRow({
                title: '智能抠除纯色背景 (AI 生成白底/绿幕一键变透明)',
                active: adoptDraft.autoRemoveBg,
                visible: adoptDraft.skinModeIdx !== 0,
            });
            autoBgRow.connect('notify::active', () => { adoptDraft.autoRemoveBg = autoBgRow.get_active(); });
            adoptGroup.add(autoBgRow);

            newModeCombo.connect('notify::selected', () => {
                adoptDraft.skinModeIdx = newModeCombo.get_selected();
                newPresetCombo.set_visible(adoptDraft.skinModeIdx === 0);
                fileRow.set_visible(adoptDraft.skinModeIdx !== 0);
                colsRow.set_visible(adoptDraft.skinModeIdx === 1);
                rowsRow.set_visible(adoptDraft.skinModeIdx === 1);
                autoBgRow.set_visible(adoptDraft.skinModeIdx !== 0);
            });

            const submitRow = new Adw.ActionRow({
                title: '完成配置，迎接新伙伴！',
            });
            const adoptBtn = new Gtk.Button({
                label: '🎉 立即领养',
                css_classes: ['suggested-action'],
                valign: Gtk.Align.CENTER,
            });
            adoptBtn.connect('clicked', () => {
                const st = readRosterState(settings);
                if (st.pets.length >= MAX_ADOPTED_PETS)
                    return;
                const arch = ARCHETYPE_LIST[adoptDraft.archetypeIdx] || ARCHETYPE_LIST[0];
                const sp = SPECIES_PRESETS[adoptDraft.presetIdx] || SPECIES_PRESETS[0];
                const modeMap = ['preset', 'spritesheet', 'gif'];
                const newPet = createNewPetRecord({
                    name: (adoptDraft.name || sp.defaultName).trim(),
                    archetype: arch.id,
                    skinMode: modeMap[adoptDraft.skinModeIdx] || 'preset',
                    presetId: sp.id,
                    customPath: adoptDraft.customPath,
                    cols: adoptDraft.cols,
                    rows: adoptDraft.rows,
                    autoRemoveBg: adoptDraft.autoRemoveBg,
                });
                st.pets.push(newPet);
                writeRosterState(settings, st);
                adoptDraft.name = '新伙伴';
                rebuildSquadPage();
            });
            submitRow.add_suffix(adoptBtn);
            adoptGroup.add(submitRow);

            pageSquad.add(adoptGroup);
        } else {
            adoptGroup = new Adw.PreferencesGroup({
                title: '宠物小队已满员 (3 / 3)',
                description: '你已领养满 3 只宠物！若想领养新角色，可先在上方展开某只宠物点击「🍃 放生宠物」。',
            });
            pageSquad.add(adoptGroup);
        }
    };

    rebuildSquadPage();
    window.add(pageSquad);

    // =========================================================================
    // TAB 2: ✨ AI 生成自定义宠物提示词工坊 (AI Prompt Generator)
    // =========================================================================
    const pageAi = new Adw.PreferencesPage({
        title: 'AI 宠物提示词',
        icon_name: 'applications-science-symbolic',
    });

    const aiInputGroup = new Adw.PreferencesGroup({
        title: '✨ AI 自定义宠物精灵图提示词生成器',
        description: '输入你想要的宠物形象，自动生成严格符合本插件「10行×4列战斗+施法+日常动作规范」的中英文提示词！发给 Gemini / ChatGPT / Midjourney 生成图片后，在第一页选「AI 生成精灵图」导入即可自动去白底变成透明宠物！',
    });

    const subjectRow = new Adw.EntryRow({
        title: '你的宠物创意描述',
        text: '一只戴着魔法护目镜、背着小披风的橘色小狐狸',
    });
    aiInputGroup.add(subjectRow);

    const styleCombo = new Adw.ComboRow({
        title: '像素画风格',
        model: Gtk.StringList.new(['16-bit 精致复古像素画', 'Q版大头二头身像素风']),
    });
    aiInputGroup.add(styleCombo);

    const bgCombo = new Adw.ComboRow({
        title: '自动抠图背景底色',
        model: Gtk.StringList.new(['纯白背景 #FFFFFF (推荐)', '纯绿幕背景 #00FF00']),
    });
    aiInputGroup.add(bgCombo);
    pageAi.add(aiInputGroup);

    const promptPreviewGroup = new Adw.PreferencesGroup({
        title: '生成的标准 10 态动作精灵图提示词（含施放技能 / 拳打脚踢 / 受击 / 潜行）',
    });

    const promptView = new Gtk.TextView({
        editable: false,
        wrap_mode: Gtk.WrapMode.WORD_CHAR,
        top_margin: 10,
        bottom_margin: 10,
        left_margin: 12,
        right_margin: 12,
        monospace: true,
    });
    const scrolled = new Gtk.ScrolledWindow({
        min_content_height: 250,
        child: promptView,
        css_classes: ['card'],
    });
    promptPreviewGroup.add(scrolled);

    let latestPrompts = buildAiPetPrompt(subjectRow.get_text());
    const updatePromptBuffer = () => {
        const stText = styleCombo.get_selected() === 1 ? 'Q版大头二头身像素风' : '16-bit 精致复古像素画';
        const bgText = bgCombo.get_selected() === 1 ? '纯绿幕背景 #00FF00' : '纯白背景 #FFFFFF';
        latestPrompts = buildAiPetPrompt(subjectRow.get_text(), stText, bgText);
        promptView.get_buffer().set_text(
            `=== 中文提示词 (适合 Gemini / 豆包 / 即梦 / GPT) ===\n${latestPrompts.zh}\n\n` +
            `=== English Prompt (适合 Midjourney / Flux / DALL-E) ===\n${latestPrompts.en}`,
            -1
        );
    };
    updatePromptBuffer();

    subjectRow.connect('changed', updatePromptBuffer);
    styleCombo.connect('notify::selected', updatePromptBuffer);
    bgCombo.connect('notify::selected', updatePromptBuffer);

    const copyRow = new Adw.ActionRow({
        title: '一键复制到系统剪贴板',
        subtitle: '复制后直接粘贴给 AI 绘图模型生成单张 PNG 即可',
    });
    const copyBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, valign: Gtk.Align.CENTER });
    const copyZhBtn = new Gtk.Button({ label: '📋 复制中文提示词', css_classes: ['suggested-action'] });
    const copyEnBtn = new Gtk.Button({ label: '📋 复制英文 Prompt' });

    copyZhBtn.connect('clicked', () => {
        copyTextToClipboard(latestPrompts.zh);
        copyRow.set_subtitle('✅ 已复制中文提示词到剪贴板！');
    });
    copyEnBtn.connect('clicked', () => {
        copyTextToClipboard(latestPrompts.en);
        copyRow.set_subtitle('✅ Copied English Prompt to clipboard!');
    });
    copyBox.append(copyZhBtn);
    copyBox.append(copyEnBtn);
    copyRow.add_suffix(copyBox);
    promptPreviewGroup.add(copyRow);

    pageAi.add(promptPreviewGroup);
    window.add(pageAi);

    // =========================================================================
    // TAB 3: ⚔️ 6 大职业流派与 36 技能图鉴 (PixelFX Skill Codex)
    // =========================================================================
    const pageSkills = new Adw.PreferencesPage({
        title: '职业与技能图鉴',
        icon_name: 'starred-symbolic',
    });

    for (const arch of ARCHETYPE_LIST) {
        const grp = new Adw.PreferencesGroup({
            title: `${arch.badge} ${arch.name}  (基础HP ${arch.baseHp} · 攻击 ${arch.baseAtk} · 暴击 ${Math.round(arch.critRate * 100)}%)`,
            description: arch.desc,
        });
        for (const sk of arch.skills) {
            grp.add(new Adw.ActionRow({
                title: `Lv.${sk.unlockLv} 解锁  ·  【${sk.name}】`,
                subtitle: `冷却 ${sk.cd}s  ·  倍率 ${Math.round((sk.power || 0) * 100)}%${sk.healPct ? `  ·  回血 ${Math.round(sk.healPct * 100)}%` : ''}${sk.slowSec ? `  ·  减速控场 ${sk.slowSec}s` : ''}  ·  特效: ${sk.fxMain}`,
            }));
        }
        pageSkills.add(grp);
    }
    window.add(pageSkills);

    // =========================================================================
    // TAB 4: 🌐 局域网联机与显示控制
    // =========================================================================
    const pageNet = new Adw.PreferencesPage({
        title: '联机·显示·更新',
        icon_name: 'network-workgroup-symbolic',
    });

    const lanGroup = new Adw.PreferencesGroup({
        title: '局域网无中心联机与同屏对战',
        description: '同一局域网下装有本插件的电脑会自动互相发现（UDP 49271），不限同屏人数且自适应双方不同显示器分辨率！点击顶部栏上的访客宠物即可发起决斗。',
    });
    const ownerRow = new Adw.EntryRow({
        title: '我的主人昵称 (在对方屏幕与对战舞台显示)',
        text: settings.get_string('owner-name') || GLib.get_user_name() || 'Player',
    });
    ownerRow.connect('changed', () => {
        settings.set_string('owner-name', ownerRow.get_text().trim());
    });
    lanGroup.add(ownerRow);
    lanGroup.add(createSwitchRow({
        title: '启用局域网自动发现、同屏串门与对战',
        settings,
        key: 'lan-enabled',
    }));
    pageNet.add(lanGroup);

    const dispGroup = new Adw.PreferencesGroup({
        title: '顶部栏显示与操控调整',
    });
    dispGroup.add(createSpinRow({ title: '宠物高度尺寸 (px)', subtitle: '支持滚轮实时缩放', settings, key: 'pet-size', min: 18, max: 64, step: 2 }));
    dispGroup.add(createSpinRow({ title: '移动速度倍率', settings, key: 'walk-speed', min: 0.3, max: 3.0, step: 0.1, digits: 1 }));
    dispGroup.add(createSpinRow({ title: '垂直偏移微调 (px)', settings, key: 'vertical-offset', min: -20, max: 24 }));
    dispGroup.add(createSpinRow({ title: '不透明度 (50–255)', settings, key: 'pet-opacity', min: 50, max: 255, step: 5 }));
    dispGroup.add(createSwitchRow({ title: '像素锐利缩放 (Nearest-Neighbor)', settings, key: 'pixel-art-scaling' }));
    dispGroup.add(createSwitchRow({ title: '鼠标穿透模式 (Ghost Mode)', settings, key: 'click-through' }));
    dispGroup.add(createSwitchRow({ title: '显示右上角状态栏小猫图标', settings, key: 'show-panel-icon' }));
    pageNet.add(dispGroup);

    // =========================================================================
    // GitHub Release Auto-Check & One-Click Self-Updater Group
    // =========================================================================
    const resolvedExtPath = extensionPath || GLib.build_filenamev([
        GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'topbar-pet@local.gnome-extension',
    ]);
    const updater = new UpdateChecker({
        extensionPath: resolvedExtPath,
        settings,
    });
    window.connect('close-request', () => {
        updater.destroy();
        return false;
    });

    const updateGroup = new Adw.PreferencesGroup({
        title: '🔄 插件版本检测与一键在线更新',
        description: '直接连接 GitHub Releases (zhiyang66/topbar-pets) 检查新版本，支持一键下载并覆盖安装更新包。',
    });

    updateGroup.add(createSwitchRow({
        title: '启动后自动静默检查新版本',
        subtitle: '发现新版本时宠物会在顶部栏轻声提醒',
        settings,
        key: 'auto-check-updates',
    }));

    const versionRow = new Adw.ActionRow({
        title: `当前已安装版本：v${updater.currentVersion}`,
        subtitle: updater.statusText,
    });

    const updBtnBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        valign: Gtk.Align.CENTER,
    });

    const checkBtn = new Gtk.Button({ label: '🔍 检查更新' });
    const installBtn = new Gtk.Button({
        label: '🚀 一键更新',
        css_classes: ['suggested-action'],
        visible: false,
    });
    const notesBtn = new Gtk.Button({ label: '🌐 Release 页面' });

    const syncUpdateRowUi = snap => {
        versionRow.set_title(`当前已安装版本：v${snap.currentVersion}`);
        versionRow.set_subtitle(snap.statusText);
        checkBtn.set_sensitive(!snap.isChecking && !snap.isInstalling);
        installBtn.set_visible(Boolean(snap.hasUpdate));
        installBtn.set_sensitive(!snap.isInstalling);
        if (snap.hasUpdate)
            installBtn.set_label(`🚀 一键更新至 v${snap.latestVersion}`);
    };
    updater._onUpdateStateChanged = syncUpdateRowUi;

    checkBtn.connect('clicked', () => {
        updater.checkForUpdates();
    });
    installBtn.connect('clicked', () => {
        updater.downloadAndInstallUpdate();
    });
    notesBtn.connect('clicked', () => {
        try {
            Gio.AppInfo.launch_default_for_uri(updater.htmlUrl || RELEASES_PAGE_URL, null);
        } catch (_e) {}
    });

    updBtnBox.append(checkBtn);
    updBtnBox.append(installBtn);
    updBtnBox.append(notesBtn);
    versionRow.add_suffix(updBtnBox);
    updateGroup.add(versionRow);
    pageNet.add(updateGroup);

    window.add(pageNet);
}
