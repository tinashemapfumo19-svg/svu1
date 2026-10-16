# Phase 1 Master Data Catalog

## Academic Organization

| Data Set | Owner | Inventory Links | Phase 1 Requirement |
| --- | --- | --- | --- |
| Faculties | Academic management | ACA-01, ACA-03 | Create, update, deactivate, and effective-date ownership. |
| Departments | Academic management | ACA-02, ACA-03, STF-03 | Maintain department-to-faculty history and active state. |
| Programme catalogue | Academic management/registry | ACA-04, ACA-05, ADM-05 | Publish programme records with code, award, level, mode, status, owner, and admissions availability. |
| Programme versions | Academic management/registry | ACA-06, ACA-08 | Preserve historical rules while allowing new curricula and requirements. |
| Course catalogue | Academic management | ACA-07 | Maintain course code, title, credits, level, prerequisites, status, and department ownership. |
| Curriculum versions | Academic management | ACA-08 | Link programme versions to course requirements, term placement, and rules. |

## Periods and Intakes

| Data Set | Owner | Inventory Links | Phase 1 Requirement |
| --- | --- | --- | --- |
| Academic years | Registry | ACA-10, ACA-11, ACA-12 | Define current and historical academic years. |
| Terms/semesters | Registry/academic management | ACA-11, ACA-15 | Model registration, teaching, assessment, publication, and archive windows. |
| Intakes | Admissions/registry | ACA-09, ACA-10 | Capacity, application window, programme availability, status, and owner approval. |
| Registration windows | Registry | ACA-15, REG-15 | Used later by registration eligibility and exceptions. |

## Rules and Reference Values

| Data Set | Owner | Inventory Links | Phase 1 Requirement |
| --- | --- | --- | --- |
| Countries | Registry/admissions | ADM-03 | Normalize applicant and student country data. |
| Academic levels | Academic management | ADM-02, ACA-06 | Controlled level/class list for admissions and programme setup. |
| Study modes/categories | Registry | ADM-04, REG-13 | Full-time, part-time, distance, or approved institutional terms. |
| Disability list | Registry/student support | REG-05 | Restrict access and retain lawful-purpose note. |
| Religion list | Registry | REG-05 | Validate whether still required before rollout. |
| Currency | Finance | ACA-14, FIN-14 | Required before fee/payment work, but can be seeded in Phase 1. |
| Grading schemes | Academic management/exams | ACA-13, EXM-11 | Versioned definitions for later examination and GPA work. |
| GPA rule sets | Academic management/exams | EXM-20 | Prepare versioned rule model and sample validation approach. |

## Publication Controls

Master data that can affect applications, registration, finance, assessment, or official records must have:

- draft and published states;
- owner and approval history;
- effective start and optional end date;
- non-destructive retirement/deactivation;
- audit events for create, update, publish, retire, and restore.
