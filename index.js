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
  const issueUrl = issue.url;
  const repositoryLabels = core.getInput('repository-labels').split(',');
  const issueLabelNames = issue.labels.map(label => label.name).concat(repositoryLabels);

  console.dir(issue)

  getLabelsOfBoard(apiKey, apiToken, boardId).then(function(response) {
    console.dir(response)
    const trelloLabels = response;
    const trelloLabelIds = [];
    issueLabelNames.forEach(function(issueLabelName) {
      // @ts-ignore type is unknown but its a json dict
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
      console.dir(response)
      const params = {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issueNumber: issueNumber,
        // @ts-ignore type is unknown but its a json dict
        body: issueBody + '\r\n\r\n' + `This issue was automatically linked to Trello card [${response['name']}](${response['shortUrl']}). Closing this issue will move the Trello card to the archive.\r\n<!---WARNING DO NOT MOVE OR REMOVE THIS ID! IT MUST STAY AT THE END OF THE THIS BODY ${response['id']}-->`
      }

      patch(issueUrl, params)
    });
  });
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

  if (cardId) {
    updateCardLocation(apiKey, apiToken, cardId, destinationListId).then(function(response) {
      console.dir(response)
    });
  } else {
    core.setFailed(`Card ${cardId} not found.`);
  }
}

async function getLabelsOfBoard(apiKey, apiToken, boardId) {
  const options = {
    method: 'GET',
    json: true,
  }
  const response = await fetch(`https://api.trello.com/1/boards/${boardId}/labels?key=${apiKey}&token=${apiToken}`, options);
  return await response.json();
}

async function getCard(apiKey, apiToken, cardId) {
  const options = {
    method: 'GET',
    json: true,
  }
  const response = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${apiKey}&token=${apiToken}`, options);
  return await response.json();
}

async function createCard(apiKey, apiToken, listId, params) {
  const options = {
    method: 'POST',
    form: {
      'idList': listId,
      'keepFromSource': 'all',
      'key': apiKey,
      'token': apiToken,
      'name': `[#${params.number}] ${params.title}`,
      'desc': params.description,
      'urlSource': params.url,
      'idLabels': params.labelIds
    },
    json: true,
  }

  const response = await fetch('https://api.trello.com/1/cards', options)
  return response
}

async function updateCardLocation(apiKey, apiToken, cardId, newListId) {
  const options = {
    method: 'PUT',
    form: {
      'idList': newListId,
    },
    json: true,
  }
  const response = await fetch(`https://api.trello.com/1/cards/${cardId}?key=${apiKey}&token=${apiToken}`, options)
  return await response.json()
}

async function patch(url, params) {
  console.dir(`Calling PATCH for ${url}`);
  const octokit = new Octokit()
  await octokit.request(`PATCH ${url}`, params);
}
