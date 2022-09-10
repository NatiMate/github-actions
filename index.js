const core = require('@actions/core');
const github = require('@actions/github');
const { Octokit } = require('@octokit/rest');
const fetch = require('./node_modules/node-fetch');

try {
  const apiKey = process.env['TRELLO_API_KEY'];
  const apiToken = process.env['TRELLO_API_TOKEN'];
  const action = core.getInput('trello-action');

  switch (action) {
    case 'create_card_when_issue_opened':
      createCardWhenIssueOpen(apiKey, apiToken);
      break;
    case 'move_card_when_pull_request_opened':
      moveCardWhenPullRequestOpen(apiKey, apiToken);
      break;
    case 'move_card_when_issue_closed':
      moveCardWhenIssueClose(apiKey, apiToken);
      break;
  }
} catch (error) {
  core.setFailed(error.message);
}

function createCardWhenIssueOpen(apiKey, apiToken) {
  const issue = github.context.payload.issue
  if (typeof issue == 'undefined') {
    core.setFailed('Action create_card_when_issue_opened may only be called on issues.');
    return;
  }

  const boardId = process.env['TRELLO_BOARD_ID'];
  const repositoryLabels = core.getInput('repository-labels').split(',');
  const issueLabelNames = issue.labels.map(label => label.name).concat(repositoryLabels);

  getLabelsOfBoard(apiKey, apiToken, boardId).then(function(response) {
    const trelloLabels = response;
    const trelloLabelIds = [];
    issueLabelNames.forEach(function(issueLabelName) {
      trelloLabels.forEach(function(trelloLabel) {
        if (trelloLabel.name == issueLabelName) {
          trelloLabelIds.push(trelloLabel.id);
        }
      });
    });

    var issueBody = issue.body;
    const issueNumber = issue.number;
    const cardParams = {
      key: apiKey,
      token: apiToken,
      idList: process.env['TRELLO_TO_DO_LIST_ID'],
      desc: issueBody,
      urlSource: issue.html_url,
      idLabels: trelloLabelIds.join(),
      name: `[%23${issueNumber}]+${issue.title}`
    }

    createCard(cardParams).then(function(response) {
      console.dir(`Successfully created trello card.`);
      patchIssue(
        github.context.repo.owner,
        github.context.repo.repo,
        issueNumber,
        issueBody + `\n\nThis issue was automatically linked to Trello card [${response['name']}](${response['shortUrl']}). Closing this issue will move the Trello card to the archive.\n<!---WARNING DO NOT MOVE OR REMOVE THIS ID! IT MUST STAY AT THE END OF THE THIS BODY ${response['id']}-->`,
      ).catch((error) => core.setFailed(`Created trello card but could not patch issue. ${error}`))
    }).catch((error) => core.setFailed(`Could not create trello card. ${error}`));
  }).catch((error) => core.setFailed(`Could not fetch trello board labels. ${error}`));
}

function moveCardWhenPullRequestOpen(apiKey, apiToken) {
  const pullRequest = github.context.payload.pull_request
  if (typeof pullRequest == 'undefined') {
    core.setFailed('Action move_card_when_pull_request_opened may only be called on pull requests.');
    return;
  }
  if (typeof pullRequest.body !== 'string') {
    return;
  }

  const keywordRegex = new RegExp(/(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved) ((?<owner>[^ ]+?)\/(?<repo>[^ ]+?))?#(?<issueNumber>[0-9]+)/, "i")
  const matches = [...pullRequest.body.matchAll(keywordRegex)]
  const octokit = new Octokit({auth: core.getInput('repo-token')})

  matches.forEach(element => {
    const owner = element[2] ?? github.context.repo.owner;
    const repo = element[3] ?? github.context.repo.repo;
    const issue_number = Number(element[4]);

    octokit.rest.issues.get({
      owner: owner,
      repo: repo,
      issue_number: issue_number
    }).then(issue => {
      const body = issue['body'];
      const cardId = body.substring(body.length-27, body.length-3);
      const cardParams = {
        key: apiKey,
        token: apiToken,
        idList: process.env['TRELLO_REVIEW_LIST_ID'],
        urlSource: pullRequest.html_url,
      }
      
      updateCard(cardId, cardParams).then(function(response) {
        console.dir(`Successfully updated card ${cardId}`)
      }).catch((error) => core.setFailed(`Could not update trello card. ${error}`));
    }).catch(error => core.setFailed(`Could not get issue ${owner}/${repo}#${issue_number}. ${error}`));
  })
}

function moveCardWhenIssueClose(apiKey, apiToken) {
  const issue = github.context.payload.issue
  if (typeof issue == 'undefined') {
    core.setFailed('Action move_card_when_issue_closed may only be called on issues.');
    return;
  }

  if (typeof issue.body !== 'string') {
    core.setFailed('Action move_card_when_issue_closed can only succeed on issues with a body.');
    return;
  }
  
  const description = issue.body;
  const cardId = description.substring(description.length-27, description.length-3)
  const cardParams = {
    key: apiKey,
    token: apiToken,
    idList: process.env['TRELLO_DONE_LIST_ID'],
  }

  updateCard(cardId, cardParams).then(function(response) {
    console.dir(`Successfully updated card ${cardId}`)
    const newBody = description.replace(/\n\nThis issue was automatically linked to Trello card \[.+?\)\. Closing this issue will move the Trello card to the archive\.\n<!---WARNING DO NOT MOVE OR REMOVE THIS ID! IT MUST STAY AT THE END OF THE THIS BODY .+?-->/, '');
    patchIssue(
      github.context.repo.owner,
      github.context.repo.repo,
      issue.number,
      newBody,
    ).catch((error) => core.setFailed(`Moved trello card but could not patch issue. ${error}`))
  }).catch((error) => core.setFailed(`Could not update trello card. ${error}`));
}

async function getLabelsOfBoard(apiKey, apiToken, boardId) {
  const options = {
    method: 'GET',
    headers: {
      "Content-Type": "application/json"
    },
  }
  const response = await fetch(`https://api.trello.com/1/boards/${boardId}/labels?key=${apiKey}&token=${apiToken}`, options);
  return await response.json();
}

async function getCard(apiKey, apiToken, cardId) {
  const options = {
    method: 'GET',
    headers: {
      "Content-Type": "application/json"
    },
  }
  const response = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${apiKey}&token=${apiToken}`, options);
  return await response.json();
}

async function createCard(params) {
  const options = {
    method: 'POST',
    headers: {
      "Content-Type": "application/json"
    },
  }

  var queryParameters = ""
  for (const [key, value] of Object.entries(params)) {
      if (queryParameters !== "") {
          queryParameters += '&'
      }
      queryParameters += `${key}=${value}`
  }

  const response = await fetch(`https://api.trello.com/1/cards?${queryParameters}`, options);
  return await response.json();
}

async function updateCard(cardId, params) {
  const options = {
    method: 'PUT',
    headers: {
      "Content-Type": "application/json"
    },
  }

  var queryParameters = ""
  for (const [key, value] of Object.entries(params)) {
      if (queryParameters !== "") {
          queryParameters += '&'
      }
      queryParameters += `${key}=${value}`
  }

  const response = await fetch(`https://api.trello.com/1/cards/${cardId}?${queryParameters}`, options)
  return await response.json();
}

async function patchIssue(owner, repo, issue_number, body) {
  console.dir(`Calling PATCH for /repos/${owner}/${repo}/issues/${issue_number}`);
  const octokit = new Octokit({auth: core.getInput('repo-token')})
  await octokit.request(`PATCH /repos/${owner}/${repo}/issues/${issue_number}`, {
    owner: owner,
    repo: repo,
    issue_number: issue_number,
    body: body
  });
}
