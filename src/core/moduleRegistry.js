export const MODULES = {
  research: true,
  militia: true,
  ascension: true,
  automation: false,
  relics: false,
  labs: false,
  events: false,
};

export function isModuleEnabled(moduleName) {
  return Boolean(MODULES[moduleName]);
}

export function setModuleEnabled(moduleName, enabled) {
  if (!Object.prototype.hasOwnProperty.call(MODULES, moduleName)) {
    throw new Error(`Unknown module: ${moduleName}`);
  }
  MODULES[moduleName] = Boolean(enabled);
  return MODULES[moduleName];
}
