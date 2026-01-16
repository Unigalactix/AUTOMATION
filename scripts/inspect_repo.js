const readline = require('readline');
const {
    checkRepoAccess,
    getRepoRootFiles,
    getRepoDirectoryFiles,
    listAccessibleRepos
} = require('../githubService');
const {
    createIssue,
    getProjects,
    searchIssues,
    updateIssue
} = require('../jiraService');
require('dotenv').config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'DOT';

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function inspectRepo() {
    console.log('--- GitHub Repo Health Inspector ---');
    console.log('This script checks a GitHub repository for common issues and creates Jira tickets for them.');
    console.log(`Target Jira Project: ${JIRA_PROJECT_KEY}`);
    console.log('------------------------------------');

    try {
        console.log('\nFetching accessible repositories...');
        const repos = await listAccessibleRepos();
        let repoName = '';

        if (repos.length > 0) {
            console.log('\nFound Repositories:');
            repos.slice(0, 15).forEach((r, i) => { // Limit display to 15 for brevity
                console.log(`[${i + 1}] ${r.full_name} ${r.private ? '(🔒 Private)' : ''}`);
            });
            if (repos.length > 15) console.log(`... and ${repos.length - 15} more.`);

            const answer = await askQuestion('\nSelect repository number or type "owner/repo": ');
            const choice = answer.trim();
            const num = parseInt(choice);

            if (!isNaN(num) && num > 0 && num <= repos.length) {
                repoName = repos[num - 1].full_name;
            } else {
                repoName = choice;
            }
        } else {
            console.log('No repositories found (or failed to list).');
            const answer = await askQuestion('Enter repository (owner/repo): ');
            repoName = answer.trim();
        }

        if (!repoName.match(/^[a-zA-Z0-9-]+\/[a-zA-Z0-9-._]+$/)) {
            console.error('❌ Invalid format. Please use "owner/repo".');
            rl.close();
            return;
        }

        console.log(`\n🔍 Verifying access to ${repoName}...`);
        const accessCheck = await checkRepoAccess(repoName);

        if (!accessCheck.accessible) {
            console.error(`\n❌ Error: Repository not found or PAT does not have access.`);
            console.error(`Status: ${accessCheck.error}`);
            console.error('Please checks your GHUB_TOKEN in .env and repository permissions.');
            rl.close();
            return;
        }

        console.log('✅ Access confirmed. Inspecting repository...');

        // Fetch files for inspection
        const rootFiles = await getRepoRootFiles(repoName);
        const lowerFiles = rootFiles.map(f => f.toLowerCase());
        const findings = [];

        // 1. Check README
        if (!lowerFiles.includes('readme.md') && !lowerFiles.includes('readme.txt') && !lowerFiles.includes('readme')) {
            findings.push({
                summary: `Missing README in ${repoName}`,
                description: `The repository [${repoName}|https://github.com/${repoName}] is missing a README file. Please add a README.md to document the project.`
            });
            console.log('   ❌ Missing README');
        } else {
            console.log('   ✅ README found');
        }

        // 2. Check LICENSE
        if (!lowerFiles.includes('license') && !lowerFiles.includes('license.md') && !lowerFiles.includes('license.txt') && !lowerFiles.includes('copying')) {
            findings.push({
                summary: `Missing LICENSE in ${repoName}`,
                description: `The repository [${repoName}|https://github.com/${repoName}] is missing a LICENSE file. Please add an appropriate open source license.`
            });
            console.log('   ❌ Missing LICENSE');
        } else {
            console.log('   ✅ LICENSE found');
        }

        // 3. Check .gitignore
        if (!lowerFiles.includes('.gitignore')) {
            findings.push({
                summary: `Missing .gitignore in ${repoName}`,
                description: `The repository [${repoName}|https://github.com/${repoName}] is missing a .gitignore file. This is essential to prevent committing temporary or sensitive files.`
            });
            console.log('   ❌ Missing .gitignore');
        } else {
            console.log('   ✅ .gitignore found');
        }

        // 4. Check Workflow Files
        const workflowFiles = await getRepoDirectoryFiles(repoName, '.github/workflows');
        const hasWorkflows = workflowFiles.length > 0;

        if (!hasWorkflows) {
            findings.push({
                summary: `Missing GitHub Workflows in ${repoName}`,
                description: `The repository [${repoName}|https://github.com/${repoName}] does not appear to have any CI/CD workflows in .github/workflows. Please add appropriate Actions workflows.`
            });
            console.log('   ❌ Missing CI/CD Workflows');
        } else {
            console.log(`   ✅ CI/CD Workflows found (${workflowFiles.length} file(s))`);
        }

        if (findings.length === 0) {
            console.log('\n🎉 No common issues found! Repository looks healthy.');
        } else {
            console.log(`\nFound ${findings.length} issue(s). Creating Jira tickets...`);

            for (const finding of findings) {
                let success = false;
                while (!success) {
                    // Generate Description with Template
                    let buildCmd = 'N/A';
                    let testCmd = 'N/A';
                    if (lowerFiles.includes('package.json')) {
                        buildCmd = 'npm install && npm run build';
                        testCmd = 'npm test';
                    } else if (lowerFiles.includes('pom.xml')) {
                        buildCmd = 'mvn clean install';
                        testCmd = 'mvn test';
                    } else if (lowerFiles.includes('requirements.txt')) {
                        buildCmd = 'pip install -r requirements.txt';
                        testCmd = 'pytest';
                    }

                    const newDescription = `${repoName}\n\n${finding.description}\n\nPayload:\n- Build Command: ${buildCmd}\n- Test Command: ${testCmd}`;

                    try {
                        // 1. Search for existing ticket
                        const safeSummary = finding.summary.replace(/"/g, '\\"');
                        const jql = `project = "${JIRA_PROJECT_KEY}" AND summary ~ "${safeSummary}"`;
                        const existingIssues = await searchIssues(jql);

                        if (existingIssues.length > 0) {
                            // 2. Update existing
                            await updateIssue(existingIssues[0].key, {
                                summary: finding.summary,
                                description: newDescription
                            });
                            console.log(`   ✅ Updated ${existingIssues[0].key}: ${finding.summary}`);
                            success = true;
                        } else {
                            // 3. Create new
                            const ticket = await createIssue(
                                JIRA_PROJECT_KEY,
                                finding.summary,
                                newDescription,
                                'Task' // Issue Type
                            );
                            console.log(`   ✅ Created ${ticket.key}: ${finding.summary}`);
                            success = true;
                        }
                    } catch (err) {
                        const errMsg = JSON.stringify(err.message || '');
                        // Check for project error (generic 400 or specific message)
                        if (errMsg.includes('valid project is required') || errMsg.includes('project is required') || (err.message && err.message.includes('400'))) {
                            console.log(`\n⚠️ Invalid Project Key: ${JIRA_PROJECT_KEY}`);
                            console.log('Fetching available projects...');

                            try {
                                const projects = await getProjects();
                                if (projects.length === 0) {
                                    console.error('❌ No projects found or failed to fetch projects.');
                                    throw err; // Stop trying if we can't find projects
                                }

                                console.log('\nAvailable Projects:');
                                projects.forEach((p, index) => {
                                    console.log(`[${index + 1}] ${p.key} (${p.name})`);
                                });

                                const answer = await askQuestion('\nSelect project number or type KEY: ');
                                const choice = answer.trim();

                                // Check if number
                                const num = parseInt(choice);
                                if (!isNaN(num) && num > 0 && num <= projects.length) {
                                    JIRA_PROJECT_KEY = projects[num - 1].key;
                                } else {
                                    // Assume key
                                    JIRA_PROJECT_KEY = choice.toUpperCase();
                                }
                                console.log(`\n🔄 Retrying with project: ${JIRA_PROJECT_KEY}...`);
                                // Loop will continue and retry search/create

                            } catch (projErr) {
                                console.error('Error fetching project list:', projErr.message);
                                throw err; // Abort this ticket
                            }
                        } else {
                            console.error(`   ❌ Failed to process "${finding.summary}": ${err.message}`);
                            break; // Not a project error, skip to next finding
                        }
                    }
                }
            }
        }

    } catch (error) {
        console.error('An unexpected error occurred:', error.message);
    } finally {
        rl.close();
    }
}

inspectRepo();
