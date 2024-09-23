
pub fn strip_jsonc_comments(jsonc_input: &str, preserve_locations: bool) -> String {
  let mut json_output = String::new();

  let mut block_comment_depth: u8 = 0;
  let mut is_in_string: bool = false; // Comments cannot be in strings

  for line in jsonc_input.split('\n') {
      let mut last_char: Option<char> = None;
      for cur_char in line.chars() {
          // Check whether we're in a string
          if block_comment_depth == 0 && last_char != Some('\\') && cur_char == '"' {
              is_in_string = !is_in_string;
          }

          // Check for line comment start
          if !is_in_string && last_char == Some('/') && cur_char == '/' {
              last_char = None;
              if preserve_locations {
                  json_output.push_str("  ");
              }
              break; // Stop outputting or parsing this line
          }
          // Check for block comment start
          if !is_in_string && last_char == Some('/') && cur_char == '*' {
              block_comment_depth += 1;
              last_char = None;
              if preserve_locations {
                  json_output.push_str("  ");
              }
          // Check for block comment end
          } else if !is_in_string && last_char == Some('*') && cur_char == '/' {
              if block_comment_depth > 0 {
                  block_comment_depth -= 1;
              }
              last_char = None;
              if preserve_locations {
                  json_output.push_str("  ");
              }
          // Output last char if not in any block comment
          } else {
              if block_comment_depth == 0 {
                  if let Some(last_char) = last_char {
                      json_output.push(last_char);
                  }
              } else {
                  if preserve_locations {
                      json_output.push_str(" ");
                  }
              }
              last_char = Some(cur_char);
          }
      }

      // Add last char and newline if not in any block comment
      if let Some(last_char) = last_char {
          if block_comment_depth == 0 {
              json_output.push(last_char);
          } else if preserve_locations {
              json_output.push(' ');
          }
      }

      // Remove trailing whitespace from line
      while json_output.ends_with(' ') {
          json_output.pop();
      }
      json_output.push('\n');
  }

  json_output
}
