-- Global extraction schemas (org_id null = available to all orgs) -------------
insert into public.extraction_schemas (org_id, doc_type, name, version, json_schema, prompt_template) values
(null, 'patent', 'Patent claims & metadata', 1,
 '{"type":"object","properties":{"title":{"type":"string"},"assignee":{"type":"string"},"inventors":{"type":"array","items":{"type":"string"}},"filing_date":{"type":"string"},"priority_date":{"type":"string"},"abstract":{"type":"string"},"independent_claims":{"type":"array","items":{"type":"string"}},"key_compounds":{"type":"array","items":{"type":"string"}}}}'::jsonb,
 'Extract patent metadata and the independent claims verbatim.'),
(null, 'ind', 'IND application summary', 1,
 '{"type":"object","properties":{"sponsor":{"type":"string"},"drug_name":{"type":"string"},"indication":{"type":"string"},"phase":{"type":"string"},"route_of_administration":{"type":"string"},"primary_objective":{"type":"string"},"submission_date":{"type":"string"}}}'::jsonb,
 'Extract the key IND application fields.'),
(null, 'csr', 'Clinical study report', 1,
 '{"type":"object","properties":{"study_title":{"type":"string"},"study_phase":{"type":"string"},"indication":{"type":"string"},"primary_endpoint":{"type":"string"},"n_subjects":{"type":"number"},"primary_result":{"type":"string"},"safety_summary":{"type":"string"},"conclusion":{"type":"string"}}}'::jsonb,
 'Extract the study design, endpoints, and primary results.'),
(null, 'protocol', 'Clinical protocol', 1,
 '{"type":"object","properties":{"protocol_number":{"type":"string"},"title":{"type":"string"},"phase":{"type":"string"},"design":{"type":"string"},"primary_objective":{"type":"string"},"primary_endpoint":{"type":"string"},"inclusion_criteria":{"type":"array","items":{"type":"string"}}}}'::jsonb,
 'Extract protocol identifiers, design, objectives, and key eligibility criteria.');

-- Compliance rules: ICH E6(R3) GCP essentials ---------------------------------
insert into public.compliance_rules (org_id, standard, rule_key, description, check_spec) values
(null, 'ich_e6_r3', 'protocol_objectives', 'The protocol defines clear primary and secondary objectives.', '{"look_for":"primary and secondary study objectives"}'::jsonb),
(null, 'ich_e6_r3', 'informed_consent', 'An informed consent process is documented for participants.', '{"look_for":"informed consent process and documentation"}'::jsonb),
(null, 'ich_e6_r3', 'risk_based_monitoring', 'A risk-based quality management / monitoring approach is described.', '{"look_for":"risk-based monitoring or quality management"}'::jsonb),
(null, 'ich_e6_r3', 'data_integrity_alcoa', 'Data are attributable, legible, contemporaneous, original, accurate (ALCOA+).', '{"look_for":"data integrity / ALCOA principles"}'::jsonb),
(null, 'ich_e6_r3', 'safety_reporting', 'Adverse event and safety reporting procedures are defined.', '{"look_for":"adverse event and safety reporting"}'::jsonb);

-- Compliance rules: 21 CFR Part 11 (electronic records) ----------------------
insert into public.compliance_rules (org_id, standard, rule_key, description, check_spec) values
(null, 'cfr_part_11', 'audit_trail', 'Secure, computer-generated, time-stamped audit trails exist.', '{"look_for":"audit trail of record changes"}'::jsonb),
(null, 'cfr_part_11', 'electronic_signatures', 'Electronic signatures are unique and linked to records.', '{"look_for":"electronic signature controls"}'::jsonb),
(null, 'cfr_part_11', 'access_controls', 'System access is limited to authorized individuals.', '{"look_for":"access control / authorization"}'::jsonb),
(null, 'cfr_part_11', 'system_validation', 'Systems are validated for accuracy and reliability.', '{"look_for":"system validation"}'::jsonb);

-- Global workflow templates (org_id null) ------------------------------------
insert into public.workflow_templates (org_id, key, name, description, category, version, definition, input_schema) values
(null, 'patent_prior_art', 'Prior Art Analysis', 'Analyze a compound against patents and clinical-trial insights in your data room.', 'patent_prior_art', 1,
 '{"steps":[
   {"id":"s1","name":"Search prior art","type":"retrieval","config":{"query":"{{input.query}}"}},
   {"id":"s2","name":"Analyze prior art","type":"llm_tool","model":"opus","tools":["search_data_room","list_documents"],"escalation_policy":{"type":"confidence_below","threshold":0.7},"system_prompt":"You are a patent analyst. Assess novelty and prior art for the objective using the data room. Flag any blocking references. Lower your confidence if evidence is thin."},
   {"id":"s3","name":"Review prior-art assessment","type":"human_approval"},
   {"id":"s4","name":"Assemble prior-art memo","type":"compose","model":"opus","system_prompt":"Assemble a clear prior-art memo in Markdown with sections: Summary, Relevant references, Novelty assessment, Risks, Recommendation."}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"Compound or objective"}},"required":["query"]}'::jsonb),

(null, 'patent_extraction', 'Patent Extraction', 'Extract and structure claims from patent documents.', 'patent_prior_art', 1,
 '{"steps":[
   {"id":"s1","name":"Locate patent content","type":"retrieval","config":{"query":"{{input.query}}"}},
   {"id":"s2","name":"Extract and structure claims","type":"llm_tool","model":"opus","tools":["search_data_room"],"system_prompt":"Extract the independent claims and key metadata verbatim and structure them clearly."},
   {"id":"s3","name":"Claims summary","type":"compose","model":"opus","system_prompt":"Produce a structured Markdown summary of the patent claims and metadata."}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"Patent or compound"}},"required":["query"]}'::jsonb),

(null, 'ind_assembly', 'IND Workspace', 'Draft and assemble IND application sections from your data room.', 'ind_assembly', 1,
 '{"steps":[
   {"id":"s1","name":"Gather supporting evidence","type":"retrieval","config":{"query":"{{input.query}}"}},
   {"id":"s2","name":"Draft IND module summaries","type":"llm_tool","model":"opus","tools":["search_data_room","list_documents"],"escalation_policy":{"type":"confidence_below","threshold":0.75},"system_prompt":"Draft concise IND module summaries (nonclinical, clinical, CMC) grounded in the data room."},
   {"id":"s3","name":"Approve IND drafts","type":"human_approval"},
   {"id":"s4","name":"Assemble IND package","type":"compose","model":"opus","system_prompt":"Assemble an IND package outline with the drafted module summaries and a submission index."}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"Program / objective"}},"required":["query"]}'::jsonb),

(null, 'reg_report', 'Regulatory Report Assembly', 'Assemble a regulatory-ready report grounded in your documents.', 'reg_report', 1,
 '{"steps":[
   {"id":"s1","name":"Gather evidence","type":"retrieval","config":{"query":"{{input.query}}"}},
   {"id":"s2","name":"Assemble report","type":"compose","model":"opus","system_prompt":"Assemble a regulatory-ready report in Markdown with citations to source numbers."},
   {"id":"s3","name":"QA review","type":"human_approval"}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"Report objective"}},"required":["query"]}'::jsonb),

(null, 'tabular_review', 'Tabular Review', 'Ask questions across documents and map answers to a schema.', 'tabular_review', 1,
 '{"steps":[
   {"id":"s1","name":"Search documents","type":"retrieval","config":{"query":"{{input.query}}"}},
   {"id":"s2","name":"Map answers to schema","type":"llm_tool","model":"opus","tools":["search_data_room"],"system_prompt":"Answer the question across the documents and present a structured table mapping each document to the answer."},
   {"id":"s3","name":"Verify mapped table","type":"human_approval"}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"Question"}},"required":["query"]}'::jsonb),

(null, 'drug_hypothesis', 'Drug Design', 'Test a hypothesis against the evidence; always escalates for expert judgment.', 'drug_hypothesis', 1,
 '{"steps":[
   {"id":"s1","name":"Gather evidence","type":"retrieval","config":{"query":"{{input.query}}"}},
   {"id":"s2","name":"Evaluate hypothesis","type":"llm_tool","model":"opus","tools":["search_data_room"],"escalation_policy":{"type":"always_human"},"system_prompt":"Evaluate the drug-design hypothesis against available evidence. Be explicit about uncertainty; this requires expert judgment."},
   {"id":"s3","name":"Expert sign-off","type":"human_approval"},
   {"id":"s4","name":"Hypothesis report","type":"compose","model":"opus","system_prompt":"Write a hypothesis evaluation report with evidence, risks, and recommended next experiments."}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"Hypothesis"}},"required":["query"]}'::jsonb),

(null, 'doc_classification', 'Document Processing', 'Classify, summarize, and route a document or set of documents.', 'doc_classification', 1,
 '{"steps":[
   {"id":"s1","name":"Classify and summarize","type":"llm_tool","model":"haiku","tools":["list_documents","search_data_room"],"system_prompt":"Classify and summarize the relevant documents, noting type and key entities."},
   {"id":"s2","name":"Processing summary","type":"compose","model":"haiku","system_prompt":"Produce a short processing summary of what was classified and routed."}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"What to process"}},"required":["query"]}'::jsonb),

(null, 'knowledge_hub', 'Knowledge Hub', 'Connect documents and datasets into one searchable answer.', 'knowledge_hub', 1,
 '{"steps":[
   {"id":"s1","name":"Search knowledge","type":"retrieval","config":{"query":"{{input.query}}"}},
   {"id":"s2","name":"Synthesize answer","type":"compose","model":"sonnet","system_prompt":"Synthesize a clear, source-cited knowledge summary from the evidence."}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"Topic"}},"required":["query"]}'::jsonb),

(null, 'dashboard', 'On-Demand Dashboards', 'Generate an analytics narrative across your data.', 'dashboard', 1,
 '{"steps":[
   {"id":"s1","name":"Gather data","type":"retrieval","config":{"query":"{{input.query}}"}},
   {"id":"s2","name":"Dashboard narrative","type":"compose","model":"sonnet","system_prompt":"Summarize key metrics and trends as a dashboard narrative."}
 ]}'::jsonb,
 '{"type":"object","properties":{"query":{"type":"string","title":"What to analyze"}},"required":["query"]}'::jsonb);
