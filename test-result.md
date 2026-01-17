# UI Test Results & TODOs

## General Observations
- [ ] **Design System**: Blueprint JS is used consistently (Tables, Cards, Tabs, Intent Buttons).
- [ ] **Performance**: Initial load on List pages (Models, Entities, Attributes, History) has a noticeable ~3s delay (possibly simulated).
- [ ] **Language Consistency**: **CRITICAL**. The app is a mix of English (Dashboard, Models, Data) and German (History, Login).
  - `/history` uses German ("Änderungen gesamt", "Löschungen").
  - `/login` uses German ("Anmelden", "Nutzungsbedingungen").
  - Rest is English.

## Page Analysis

### Dashboard (`/`)
- [x] **Layout**: Good tile layout.
- [x] **Mocks**: "Recent Activity" table contains hardcoded mocks ("Created Customer ACME Corp").
- [ ] **Mock Replacement**: Connect Recent Activity to `mds_meta.audit_log`.

### Models (`/models`)
- [ ] **Functionality**: "Entities" button inside the Model Card `[ref=e181]` did not trigger navigation.
- [x] **Data**: Shows "CRM" and "TEST_MODEL". Data persistence seems functional.
- [x] **Layout**: Grid Card layout matches plan.

### Entities (`/entities`)
- [ ] **Status**: "Status" column is empty.
- [ ] **History**: "History" column is placeholder "—".
- [x] **Columns**: Entity, Model, Attributes (Count) are correct.

### Attributes (`/attributes`)
- [ ] **References**: "Reference" column is consistently `-`, even for `reference` type attributes (e.g., `country_id`).
- [x] **Data Types**: Correctly rendering `string (255)`, `integer`.

### Data (`/data`)
- [x] **Logic**: Correctly blocks entry for entities with no attributes (Contact).
- [x] **Functionality**: Correctly lists records for Customer.
- [x] **Actions**: Edit/Delete buttons present. Commit button enables on selection.

### Commits (`/commits`)
- [x] **Layout**: Tabs (Pending, Ready, Deployed) working.
- [x] **Data**: Shows pending commits with Metadata.

### History (`/history`)
- [ ] **Language**: Entire page is in German. Needs localization to English to match the rest of the app.
- [x] **Data**: Shows granular audit log (INSERT/UPDATE/DELETE).

## Remediation Plan
1. **Fix Language**: Standardize `src/app/history` and `src/app/(auth)/login` to English. (IGNORED by user request)
2. **Fix Navigation**: Repair "Entities" button in `ModelCard` component. (FIXED)
3. **Data Polish**: Populate "Status" and "References" columns in tables. (FIXED - Attributes page now supports Reference creation)
4. **Mock Removal**: Wire Dashboard Activity Feed to real API. (FIXED)
