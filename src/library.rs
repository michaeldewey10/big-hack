use crate::model::MovementMultipliers;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Clone, Deserialize, Serialize)]
pub struct Preset {
    pub label: String,
    pub values: MovementMultipliers,
    pub no_landing_dizziness: bool,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Library {
    pub presets: Vec<Preset>,
    pub spots: Vec<Value>,
    #[serde(skip)]
    load_error: Option<String>,
}
impl Library {
    fn path() -> Result<PathBuf, String> {
        std::env::var_os("LOCALAPPDATA")
            .map(|p| PathBuf::from(p).join("BigHack").join("library.json"))
            .ok_or_else(|| "Windows local application data folder is unavailable.".into())
    }
    pub fn load() -> Self {
        let load = || -> Result<Self, String> {
            let path = Self::path()?;
            if !path.exists() {
                return Ok(Self::default());
            }
            let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
            let mut value: Self = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            if value.presets.len() > 100 || value.spots.len() > 500 {
                return Err("Saved library exceeds the supported size.".into());
            }
            value.spots.retain(|s| valid_location(s));
            for preset in &mut value.presets {
                preset.values.clamp_supported();
            }
            Ok(value)
        };
        load().unwrap_or_else(|error| {
            crate::diagnostics::log(&format!("Library load failed: {error}"));
            Self {
                load_error: Some(error),
                ..Self::default()
            }
        })
    }
    pub fn save(&self) -> Result<(), String> {
        if let Some(error) = &self.load_error {
            return Err(format!(
                "Cannot overwrite an unreadable saved library: {error}"
            ));
        }
        let path = Self::path()?;
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(temporary, path).map_err(|e| e.to_string())
    }
}
pub fn valid_location(value: &Value) -> bool {
    value["position"].as_array().is_some_and(|a| {
        a.len() == 3 && a.iter().all(|v| v.as_f64().is_some_and(|v| v.is_finite()))
    }) && value["rotation"].as_array().is_some_and(|a| {
        a.len() == 4 && a.iter().all(|v| v.as_f64().is_some_and(|v| v.is_finite()))
    }) && value["build"].as_str().is_some_and(|v| !v.is_empty())
}
