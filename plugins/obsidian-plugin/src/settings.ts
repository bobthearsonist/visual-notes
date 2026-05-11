import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type VisualNotesPlugin from "./main";

export const SETTINGS_VERSION = "0.1.0";
export const DEFAULT_MODEL = "claude-haiku-4-5";

export interface ExtractionCounter {
  date: string;
  count: number;
}

export interface VisualNotesSettings {
  _settingsVersion: string;
  anthropicApiKey: string;
  watchedFolders: string[];
  debounceMs: number;
  model: string;
  extractionCounter: ExtractionCounter;
  firstRunNoticeShown: boolean;
  useDailyContext: boolean;
  dailyContextId: string;
}

export const DEFAULT_SETTINGS: VisualNotesSettings = {
  _settingsVersion: SETTINGS_VERSION,
  anthropicApiKey: "",
  watchedFolders: [],
  debounceMs: 1500,
  model: DEFAULT_MODEL,
  extractionCounter: { date: currentLocalDate(), count: 0 },
  firstRunNoticeShown: false,
  useDailyContext: true,
  dailyContextId: "",
};

export function currentLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class VisualNotesSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VisualNotesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Visual Notes" });

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc("Required for extraction. Stored in this plugin's data.json for the first pass.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h3", { text: "Watched folders" });
    containerEl.createEl("p", {
      text: "Add daily-note folders to enable automatic extraction. Subfolders are included.",
      cls: "setting-item-description",
    });

    this.plugin.settings.watchedFolders.forEach((folder, index) => {
      new Setting(containerEl)
        .setName(`Folder ${index + 1}`)
        .addText((text) => {
          text
            .setPlaceholder("Captains Log")
            .setValue(folder)
            .onChange(async (value) => {
              this.plugin.settings.watchedFolders[index] = value.trim();
              await this.plugin.saveSettings();
            });
        })
        .addButton((button) => {
          button
            .setButtonText("Remove")
            .onClick(async () => {
              this.plugin.settings.watchedFolders.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            });
        });
    });

    new Setting(containerEl).addButton((button) => {
      button
        .setButtonText("Add folder")
        .setCta()
        .onClick(() => {
          this.plugin.settings.watchedFolders.push("");
          this.display();
        });
    });

    new Setting(containerEl)
      .setName("Debounce")
      .setDesc("Milliseconds to wait after the last save before extracting.")
      .addText((text) => {
        text.inputEl.type = "number";
        text
          .setValue(String(this.plugin.settings.debounceMs))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 0) {
              new Notice("Visual Notes: debounce must be a non-negative number.");
              return;
            }

            this.plugin.settings.debounceMs = parsed;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Haiku is the default low-cost extraction model; Sonnet is available for harder notes.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("claude-haiku-4-5", "Claude Haiku 4.5")
          .addOption("claude-sonnet-4-6", "Claude Sonnet 4.6")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h3", { text: "Daily Context" });

    new Setting(containerEl)
      .setName("Use Daily Context when available")
      .setDesc("If the Daily Context plugin is loaded, Visual Notes extracts from its structured daily sources instead of the raw note.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.useDailyContext)
          .onChange(async (value) => {
            this.plugin.settings.useDailyContext = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Daily Context ID")
      .setDesc("Optional context id to request from Daily Context, such as personal or work. Leave blank to use Daily Context defaults.")
      .addText((text) => {
        text
          .setPlaceholder("personal")
          .setValue(this.plugin.settings.dailyContextId)
          .onChange(async (value) => {
            this.plugin.settings.dailyContextId = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }
}
