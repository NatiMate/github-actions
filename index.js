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
  const boardId = process.env['TRELLO_BOARD_ID'];
  const listId = process.env['TRELLO_TO_DO_LIST_ID'];
  const issue = github.context.payload.issue
  if (typeof issue == 'undefined') {
    core.setFailed('Action create_card_when_issue_opened may only be called on issues.');
    return;
  }

  const issueNumber = issue.number;
  const issueTitle = issue.title;
  const issueBody = issue.body;
  const issueHtmlUrl = issue.url;
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

    const cardParams = {
      number: issueNumber, title: issueTitle, description: issueBody, url: issueHtmlUrl, labelIds: trelloLabelIds.join()
    }

    createCard(apiKey, apiToken, listId, cardParams).then(function(response) {
      console.dir(`Successfully created trello card.`);
      patchIssue(
        github.context.repo.owner,
        github.context.repo.repo,
        issueNumber,
        issueBody + '\r\n\r\n' + `This issue was automatically linked to Trello card [${response['name']}](${response['shortUrl']}). Closing this issue will move the Trello card to the archive.\r\n<!---WARNING DO NOT MOVE OR REMOVE THIS ID! IT MUST STAY AT THE END OF THE THIS BODY ${response['id']}-->`,
      ).catch((error) => core.setFailed(`Created trello card but could not patch issue. ${error}`))
    }).catch((error) => core.setFailed(`Could not create trello card. ${error}`));
  }).catch((error) => core.setFailed(`Could not fetch trello board labels. ${error}`));
}

function moveCardWhenPullRequestOpen(apiKey, apiToken) {
  const destinationListId = process.env['TRELLO_REVIEW_LIST_ID'];
  const pullRequest = github.context.payload.pull_request
  if (typeof pullRequest == 'undefined') {
    core.setFailed('Action move_card_when_pull_request_opened may only be called on pull requests.');
    return;
  }
  if (typeof pullRequest.body !== 'string') {
    core.setFailed('Action move_card_when_pull_request_opened may only be called on pull requests.');
    return;
  }

  console.dir(pullRequest);
  core.setFailed('Not yet implemented');
  return;
}

function moveCardWhenIssueClose(apiKey, apiToken) {
  const destinationListId = process.env['TRELLO_DONE_LIST_ID'];
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

  updateCardLocation(apiKey, apiToken, cardId, destinationListId).then(function(response) {
    console.dir(`Successfully updated card ${cardId}`)
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

async function createCard(apiKey, apiToken, listId, params) {
  const options = {
    method: 'POST',
    headers: {
      "Content-Type": "application/json"
    },
  }

  const response = await fetch(`https://api.trello.com/1/cards?idList=${listId}&key=${apiKey}&token=${apiToken}&desc=params.description&urlSource=${params.url}&idLabels=${params.labelIds}&name=[$23${params.number}]+${params.title}`, options);
  return await response.json();
}

async function updateCardLocation(apiKey, apiToken, cardId, newListId) {
  const options = {
    method: 'PUT',
    headers: {
      "Content-Type": "application/json"
    },
  }
  const response = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${apiKey}&token=${apiToken}&idList=${newListId}`, options)
  return await response.json()
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
