"""Read-only dashboard presentation rules keyed by canonical parameter IDs."""
ADVANCED = {"fitting_quality_cole_fit_r2", "fitting_error_cole_fit_rmse", *{f"c_{n}khz" for n in (300,374,466,580,720,896,1118,1392,1729,2155,2689,3347,4158,5188,6447,8030,9995)}}
CHO_OFFLINE = ["ammonium_mm","avg_diameter_mean_m","glucose_g_l","lactate_g_l","osmolality_mosmol_kg","tcd_mean_cells_ml","vcd_mean_cells_ml","viability_mean"]
YEAST_OFFLINE = ["alcohol_content_w_w","avg_diameter_mean_m","density_g_cm3","osmolality_mosmol_kg","real_extract_sg","refractive_index","tcd_mean_cells_ml","vcd_mean_cells_ml","viability_mean"]
STATIC = {"duration_pre_culture_h","wort_concentration_plato","yeast","bottom_impeller","culture_medium","l_glutamine_start_concentration_mm"}
DIELECTRIC = {"conductivity_ms_cm", "permittivity_pf_cm", "fc_khz", "deltaeps_pf_cm", "alpha", *ADVANCED}
HELP = {"culture_medium":"0 = TC-42; 1 = TCX6D", "yeast":"0 = W-68; 1 = W-34/70", "antifoam_addition": "0 = no addition; 1 = manual antifoam addition", "antifoam_volume_ml": "Cumulative volume"}
CHO_INLINE_HELP = {"bottom_impeller": "0 = upper position; 1 = lower position (closer to Incyte)"}
STATIC_GROUPS = {
    "duration_pre_culture_h": "Duration pre-culture",
    "wort_concentration_plato": "Wort concentration",
    "yeast": "Yeast",
    "bottom_impeller": "Bottom impeller",
    "culture_medium": "Culture Medium",
    "l_glutamine_start_concentration_mm": "L-glutamine start concentration",
}
ORDER = {"dissolved_co2_sat":10,"transmission_arb_unit":20,"reflection_arb_unit":21,"absorption_filtered":22,"conductivity_ms_cm":30,"permittivity_pf_cm":31,"fc_khz":32,"deltaeps_pf_cm":33,"alpha":34,"ph":40,"temperature_c":50,"dissolved_o2_air_sat":60,"agitation_rate_rpm":70,"cumulative_naoh_amount_mmol":80,"cumulative_feed_weight_g":90,"duration_pre_culture_h":110,"wort_concentration_plato":120,"yeast":130,"bottom_impeller":140,"culture_medium":150,"l_glutamine_start_concentration_mm":160}
def layout(parameter_id, cell_type, source_kind):
    advanced = parameter_id in ADVANCED
    section = "Static Process Variables" if parameter_id in STATIC else "Dynamic Sensor Data"
    groups={"dissolved_co2_sat":"Dissolved CO2","transmission_arb_unit":"Turbidity","reflection_arb_unit":"Turbidity","absorption_filtered":"Turbidity","ph":"pH","temperature_c":"Temperature","dissolved_o2_air_sat":"Dissolved O2","agitation_rate_rpm":"Agitation","antifoam_volume_ml":"Antifoam","antifoam_addition":"Antifoam","aeration_rate_total_sl_h":"Gas Supply","aeration_rate_air_sl_h":"Gas Supply","aeration_rate_o2_sl_h":"Gas Supply","aeration_rate_co2_sl_h":"Gas Supply","aeration_rate_sl_h":"Gas Supply","o2_fraction_inlet":"Gas Supply","co2_fraction_inlet":"Gas Supply","cer_mmol_l_h":"Offgas","our_mmol_l_h":"Offgas","rq":"Offgas","co2_fraction_exhaust":"Offgas","o2_fraction_exhaust":"Offgas","liquid_volume_l":"Liquid Volume","cumulative_naoh_amount_mmol":"Base Addition","cumulative_feed_weight_g":"Feed"}
    subgroup = (
        "Dielectric Spectroscopy" if parameter_id in DIELECTRIC
        else STATIC_GROUPS.get(parameter_id, groups.get(parameter_id, "Other"))
    )
    help_text = (
        CHO_INLINE_HELP.get(parameter_id, HELP.get(parameter_id))
        if cell_type == "CHO" and source_kind == "inline"
        else HELP.get(parameter_id)
    )
    return {"section":section,"subgroup":subgroup,"order":ORDER.get(parameter_id,999),"advanced":advanced,"default_visible":not advanced,"help_text":help_text}


def is_dashboard_hidden(parameter_id, cell_type, source_kind):
    """Dashboard-only visibility; catalog and source data remain untouched."""
    return (
        cell_type == "CHO"
        and source_kind == "inline"
        and parameter_id in {"cumulative_naoh_weight_g", "naoh_concentration_m"}
    )
def offline_allowlist(cell_type): return CHO_OFFLINE if cell_type == "CHO" else YEAST_OFFLINE
def display_label(name, unit): return name if not unit or unit.lower() in name.lower() else f"{name} ({unit})"
