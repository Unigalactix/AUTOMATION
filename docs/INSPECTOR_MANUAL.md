# GitHub Repo Inspector Manual

This document details the workflow and usage of the `scripts/inspect_repo.js` automation tool. This tool is designed to audit GitHub repositories for compliance with engineering standards and automatically report issues to Jira.

## 1. Overview

The Repo Inspector scans a target GitHub repository for the presence of essential files and configurations. If any required item is missing, it automatically raises a Jira Task to address the gap.

**Key Checks:**
-   **README.md**: Documentation existence.
-   **LICENSE**: Open source or proprietary license file.
-   **.gitignore**: Source control ignore rules.
-   **CI/CD Workflows**: Existence of workflow files in `.github/workflows`.

## 2. Workflow Diagram

The following flowchart illustrates the script's execution logic:

```mermaid
flowchart TD
    Start([Start Script]) --> LoadEnv[Load .env Configuration]
    LoadEnv --> ListRepos{List Accessible Repos}
    
    ListRepos -->|Try ALLOWED_ORGS| OrgRepos[Fetch Org Repos]
    OrgRepos -->|Success| DisplayRepos[Display Repo List]
    OrgRepos -->|Fail/Empty| UserRepos[Fetch User Repos]
    UserRepos --> DisplayRepos
    
    DisplayRepos --> SelectRepo[/User Selects Repo/]
    SelectRepo --> VerifyAccess{Verify PAT Access}
    
    VerifyAccess -->|Denied| ErrorExit([Exit with Error])
    VerifyAccess -->|Allowed| Inspect[Run Inspection Checks]
    
    Inspect --> Check1{README Exists?}
    Inspect --> Check2{LICENSE Exists?}
    Inspect --> Check3{.gitignore Exists?}
    Inspect --> Check4{Workflows Exist?}
    
    Check1 -- No --> AddFinding1[Add Finding: Missing README]
    Check2 -- No --> AddFinding2[Add Finding: Missing LICENSE]
    Check3 -- No --> AddFinding3[Add Finding: Missing .gitignore]
    Check4 -- No --> AddFinding4[Add Finding: Missing Workflows]
    
    Inspect --> HasFindings{Findings Found?}
    HasFindings -->|No| SuccessExit([Exit: Repo Healthy])
    
    HasFindings -->|Yes| LoopFindings[Loop Through Findings]
    LoopFindings --> CreateTicket[Attempt Create Jira Ticket]
    
    CreateTicket --> TicketSuccess{Success?}
    TicketSuccess -->|Yes| LogSuccess[Log Ticket Created]
    TicketSuccess -->|No| CheckError{Project Invalid?}
    
    CheckError -->|Yes| SelectProject[/User Selects New Project/]
    SelectProject --> RetryCreate[Retry Create Ticket]
    RetryCreate --> CreateTicket
    
    CheckError -->|No| LogError[Log API Error]
    
    LogSuccess --> NextFinding{More Findings?}
    LogError --> NextFinding
    NextFinding -->|Yes| LoopFindings
    NextFinding -->|No| End([End Script])
```

## 3. Usage Guide

### Prerequisites
Ensure your `.env` file is configured with:
-   `GHUB_TOKEN`: A GitHub Personal Access Token with `repo` and `read:org` scopes.
-   `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`: Jira credentials.
-   `JIRA_PROJECT_KEY`: Default Jira project to create tickets in (e.g., `DOT`).
-   `ALLOWED_ORGS` (Optional): Comma-separated list of GitHub Orgs to scan.

### Running the Script
Open your terminal and run:

```bash
node scripts/inspect_repo.js
```

### Interactive Steps
1.  **Select Repository**: 
    -   The script will display a numbered list of repositories.
    -   Type the number to select one, or type `owner/repo` manually.
2.  **Monitor Progress**:
    -   The script verifies access and prints the status of each check.
3.  **Project Selection (Fallback)**:
    -   If the configured `JIRA_PROJECT_KEY` is invalid, the script will pause.
    -   It will list all available Jira projects.
    -   Select the correct project to proceed with ticket creation.

## 4. Error Handling

-   **Repo Access Denied**: Double-check your `GHUB_TOKEN` and ensure you have admin/read rights to the repository.
-   **Jira API Errors**: 
    -   401/403: Check your Jira API Token and Email.
    -   400 (Project Required): The script handles this by prompting for a new project.
